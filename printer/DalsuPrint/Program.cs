// DalsuPrint — Smart-81D/51D 카드프린터 양면 인쇄 CLI (SmartComm2 SDK, DCL 모드)
// 사용: DalsuPrint --front front.png [--back back.png] [--printer <desc>] [--dry-run] [--list]
// 종료 코드: 0 성공 / 1 인자 오류 / 2 SDK 로드 실패 / 3 프린터 연결·상태 오류 / 4 인쇄 실패
// 인쇄 시퀀스는 smart51s-nfc-writer PrinterService(2026-07 실측 검증)와 동일. RF 함수는 호출하지 않는다.
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using SmartNfcWriter;

namespace DalsuPrint
{
    internal static class Program
    {
        private const int CARD_W = 1012, CARD_H = 636;

        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

        private static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8; // Electron 로그 수집용 (stdout/stderr UTF-8 고정)
            Console.InputEncoding = System.Text.Encoding.UTF8;
            string front = null, back = null, printer = null;
            bool dryRun = false, list = false;
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--front": front = Next(args, ref i); break;
                    case "--back": back = Next(args, ref i); break;
                    case "--printer": printer = Next(args, ref i); break;
                    case "--dry-run": dryRun = true; break;
                    case "--list": list = true; break;
                    case "-h": case "--help": Usage(); return 0;
                    default: Err($"알 수 없는 인자: {args[i]}"); Usage(); return 1;
                }
            }
            if (!list && string.IsNullOrEmpty(front)) { Err("--front 필수"); Usage(); return 1; }
            if (!list && !File.Exists(front)) { Err($"앞면 파일 없음: {front}"); return 1; }
            if (!list && back != null && !File.Exists(back)) { Err($"뒷면 파일 없음: {back}"); return 1; }

            if (dryRun)
            {
                // 이미지 디코딩·리사이즈까지만 검증 (SDK/프린터 불필요) — 개발 PC 게이트
                foreach (var f in new[] { front, back }) if (f != null) using (var bmp = ToCardBitmap(f)) Log($"dry-run OK: {Path.GetFileName(f)} → {bmp.Width}x{bmp.Height}");
                Log("dry-run 완료 (실제 인쇄 없음)");
                return 0;
            }

            using var sdk = new SmartComm2Wrapper();
            string dll = Path.Combine(AppContext.BaseDirectory, "SmartComm2.dll");
            if (!sdk.Load(dll)) { Err($"SmartComm2.dll 로드 실패: {dll}"); return 2; }
            Log("SDK 로드 완료");

            sdk.GetDeviceList(out var devices);
            if (devices.count <= 0) { Err("연결된 Smart 프린터가 없습니다 (USB/전원 확인)"); return 3; }
            for (int i = 0; i < devices.count; i++) Log($"프린터[{i}] name=\"{devices.item[i].name}\" id=\"{devices.item[i].id}\" desc=\"{devices.item[i].desc}\"");
            if (list) return 0;

            // 대상 선택: --printer desc 부분 일치 우선, 없으면 첫 번째
            var target = devices.item[0];
            if (!string.IsNullOrEmpty(printer))
            {
                bool found = false;
                for (int i = 0; i < devices.count; i++)
                    if ((devices.item[i].desc ?? "").Contains(printer, StringComparison.OrdinalIgnoreCase) || (devices.item[i].name ?? "").Contains(printer, StringComparison.OrdinalIgnoreCase)) { target = devices.item[i]; found = true; break; }
                if (!found) { Err($"--printer \"{printer}\"와 일치하는 프린터 없음"); return 3; }
            }

            string sel = !string.IsNullOrEmpty(target.desc) ? target.desc : target.name;
            int res = sdk.OpenDeviceDCL(sel, true);
            if (res != SmartComm2Wrapper.SM_SUCCESS && !string.IsNullOrEmpty(target.id)) res = sdk.OpenDeviceDCL(target.id, false);
            if (res != SmartComm2Wrapper.SM_SUCCESS) { Err($"프린터 연결 실패 (0x{res:X8})"); return 3; }
            Log($"프린터 연결: {sel}");

            bool sbs = false;
            try
            {
                res = sdk.GetStatus(out long status);
                if (res != SmartComm2Wrapper.SM_SUCCESS) { Err("프린터 상태 읽기 실패"); return 3; }
                if ((status & SmartComm2Wrapper.S51PS_S_COVEROPENED) != 0) { Err("프린터 커버가 열려 있습니다"); return 3; }
                if ((status & SmartComm2Wrapper.S51PS_S_CARDEMPTY) != 0) { Err("호퍼에 카드가 없습니다"); return 3; }
                bool flipper = (status & (SmartComm2Wrapper.S51PS_S_CONNFLIPPER | SmartComm2Wrapper.S51PS_S_CONNLAMINATOR)) != 0;
                bool duplex = back != null && flipper;
                Log(flipper ? "양면(플리퍼) 모듈: 장착" : "양면 모듈 없음 — 앞면만 인쇄");
                if (back != null && !flipper) Err("경고: 뒷면 지정됐지만 플리퍼 없음 → 앞면만 인쇄");

                if (sdk.SBSStart() != SmartComm2Wrapper.SM_SUCCESS) { Err("SBS 진입 실패"); return 4; }
                sbs = true;
                sdk.ClearStatus();

                Log("카드 투입...");
                if ((res = sdk.CardIn()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"카드 투입 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                if ((res = sdk.Move(SmartComm2Wrapper.CARDPOS_PRINT)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"인쇄 위치 이동 실패 (0x{res:X8})"); Recover(sdk); return 4; }

                if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_FRONT, front)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"앞면 그리기 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                Log($"앞면 로드: {Path.GetFileName(front)}");
                if (duplex)
                {
                    if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_BACK, back)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"뒷면 그리기 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                    Log($"뒷면 로드: {Path.GetFileName(back)}");
                }

                sdk.GetRibbonInfo(out int rtype, out int rmax, out int rremain, out _);
                Log($"리본: type={rtype} 잔량={rremain}/{rmax}" + (rmax > 0 && rremain <= 0 ? " ⚠ 소진" : ""));

                int side = duplex ? SmartComm2Wrapper.PRINTSIDE_BOTH : SmartComm2Wrapper.PRINTSIDE_FRONT;
                if ((res = sdk.DCLPrint(side)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"인쇄 큐 등록 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                Log("앞면 인쇄 중...");
                if ((res = sdk.DoPrint()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"앞면 인쇄 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                if (duplex)
                {
                    Log("뒷면 인쇄 중 (플립)...");
                    if ((res = sdk.DoPrint()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"뒷면 인쇄 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                }
                Log("카드 배출...");
                if ((res = sdk.CardOut()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"카드 배출 실패 (0x{res:X8}) — 내부에 카드가 남았을 수 있음"); return 4; }
                Log(duplex ? "양면 인쇄 완료" : "단면 인쇄 완료");
                return 0;
            }
            finally
            {
                if (sbs) sdk.SBSEnd();
                sdk.CloseDeviceDCL();
            }
        }

        // 어떤 포맷/크기든 1012×636 24bpp로 리사이즈 후 HBITMAP으로 전달 (SDK 파일 디코더 우회 — 빈 카드 문제 회피)
        private static int Draw(SmartComm2Wrapper sdk, byte page, string path)
        {
            using var canvas = ToCardBitmap(path);
            IntPtr hbmp = canvas.GetHbitmap();
            try { return sdk.DrawBitmap(page, SmartComm2Wrapper.PANEL_COLOR, 0, 0, CARD_W, CARD_H, hbmp, out _); }
            finally { DeleteObject(hbmp); }
        }

        private static Bitmap ToCardBitmap(string path)
        {
            using var src = new Bitmap(path);
            var canvas = new Bitmap(CARD_W, CARD_H, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
            using var g = Graphics.FromImage(canvas);
            g.Clear(Color.White);
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.DrawImage(src, 0, 0, CARD_W, CARD_H);
            return canvas;
        }

        private static void Recover(SmartComm2Wrapper sdk)
        {
            try { sdk.CardOut(); } catch { }
            try { sdk.ClearStatus(); } catch { }
        }

        private static string Next(string[] a, ref int i) => ++i < a.Length ? a[i] : throw new ArgumentException($"{a[i - 1]} 값 누락");
        private static void Log(string m) => Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {m}");
        private static void Err(string m) => Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] ERROR {m}");
        private static void Usage() => Console.WriteLine("DalsuPrint --front <png> [--back <png>] [--printer <desc>] [--dry-run] [--list]");
    }
}
