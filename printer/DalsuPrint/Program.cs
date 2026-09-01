// DalsuPrint — Smart-81D/51D 카드프린터 양면 인쇄 CLI (SmartComm2 SDK, DCL 모드)
// 사용: DalsuPrint --front front.png [--back back.png] [--printer <desc>] [--portrait|--landscape] [--dry-run] [--list]
//       --portrait: 세로 인쇄(636x1012). Smart-31/51 과 같은 CR-80 카드를 세로로 쓴다. 기본은 가로(1012x636).
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
        // CR-80 카드. 가로 인쇄는 1012×636, 세로 인쇄는 636×1012 (Smart-31/51/81 공통 카드).
        // 라테일 팝업스토어에서 SMART-81 양면 인쇄로 실측 확인된 SDK 카드 좌표(세로 664×1040 풀블리드).
        // Smart-31/51 과 같은 CR-80 카드.
        private const int CARD_LONG = 1040, CARD_SHORT = 664;
        private static int CARD_W = CARD_LONG, CARD_H = CARD_SHORT;

        [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr hObject);

        private static int Main(string[] args)
        {
            Console.OutputEncoding = System.Text.Encoding.UTF8; // Electron 로그 수집용 (stdout/stderr UTF-8 고정)
            Console.InputEncoding = System.Text.Encoding.UTF8;
            string front = null, back = null, printer = null;
            bool dryRun = false, list = false, portrait = false;
            // comm = 드라이버(스풀러) 모드 + dwPrtSide 패치 — 라테일에서 실장비 양면 출력 확인된 경로(기본)
            // dcl  = 직접통신 SBS 시퀀스 — 라테일 기록상 "이 환경에서 IO 실패". 폴백용.
            int backRotate = 0;   // 뒷면 회전(도) — 플리퍼 축에 따라 현장에서 맞춘다
            string mode = "comm";
            for (int i = 0; i < args.Length; i++)
            {
                switch (args[i])
                {
                    case "--front": front = Next(args, ref i); break;
                    case "--back": back = Next(args, ref i); break;
                    case "--printer": printer = Next(args, ref i); break;
                    case "--dry-run": dryRun = true; break;
                    case "--portrait": portrait = true; break;
                    case "--landscape": portrait = false; break;
                    case "--mode": mode = (Next(args, ref i) ?? "comm").ToLowerInvariant(); break;
                    case "--back-rotate": backRotate = int.TryParse(Next(args, ref i), out var br) ? ((br % 360) + 360) % 360 : 0; break;
                    case "--list": list = true; break;
                    case "-h": case "--help": Usage(); return 0;
                    default: Err($"알 수 없는 인자: {args[i]}"); Usage(); return 1;
                }
            }
            if (mode != "comm" && mode != "dcl") { Err($"--mode 는 comm 또는 dcl (받은 값: {mode})"); return 1; }
            if (portrait) { CARD_W = CARD_SHORT; CARD_H = CARD_LONG; }
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] 인쇄 방향: {(portrait ? "세로(portrait)" : "가로(landscape)")} {CARD_W}x{CARD_H} · SDK 경로: {mode}");
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

            // 어떤 SDK 바이너리를 로드했는지 남긴다.
            // 구버전(2.1.33.9)은 드라이버(스풀러) 모드의 SMART-81D 를 열거하지 못했다 — 같은 장비에서
            // 2.2.00.1 로는 인쇄가 됐다. 프린터가 0개로 나올 때 가장 먼저 볼 값이다.
            try
            {
                var sdkDll = Path.Combine(AppContext.BaseDirectory, "SmartComm2.dll");
                if (File.Exists(sdkDll))
                {
                    var fv = System.Diagnostics.FileVersionInfo.GetVersionInfo(sdkDll);
                    Log($"SDK 버전 {fv.FileVersion} ({sdkDll})");
                }
                else Log($"SmartComm2.dll 을 실행 폴더에서 못 찾음: {AppContext.BaseDirectory}");
            }
            catch (Exception ex) { Log($"SDK 버전 조회 실패: {ex.Message}"); }

            int listRc = sdk.GetDeviceList(out var devices);
            Log($"GetDeviceList2 반환 {listRc} · 장치 {devices.count}개");
            if (devices.count <= 0)
            {
                Err("연결된 Smart 프린터가 없습니다.");
                Err("  확인 1: 프린터 전원·USB, 그리고 Windows '장치 및 프린터'에 SMART-81 이 보이는지");
                Err("  확인 2: 위 'SDK 버전' 이 2.2.00.1 인지 (2.1.x 는 드라이버 모드 장비를 열거하지 못한다)");
                return 3;
            }
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

            // ── comm 경로 (기본) ───────────────────────────────────────────────
            // 드라이버(스풀러) 모드로 열고, 프린터 설정의 dwPrtSide 를 양면(2)으로 강제한 뒤
            // 앞/뒤 두 면을 그리고 한 번 Print. 라테일 팝업스토어에서 실장비 양면 출력이 확인된 시퀀스.
            if (mode == "comm") return PrintViaComm(sdk, target, sel, front, back, backRotate);

            // ── dcl 경로 (폴백) ────────────────────────────────────────────────
            // 직접통신 SBS 시퀀스. 라테일 기록상 드라이버 설치 환경에서는 IO 실패했다.
            int orient = portrait ? SmartComm2Wrapper.DMORIENT_PORTRAIT : SmartComm2Wrapper.DMORIENT_LANDSCAPE;
            int res = sdk.OpenDeviceDCL(sel, true, orient);
            if (res != SmartComm2Wrapper.SM_SUCCESS && !string.IsNullOrEmpty(target.id)) res = sdk.OpenDeviceDCL(target.id, false, orient);
            if (res != SmartComm2Wrapper.SM_SUCCESS) { Err($"프린터 연결 실패 (0x{res:X8})"); return 3; }
            Stage("connect");
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

                Stage("cardin");

                Log("카드 투입...");
                if ((res = sdk.CardIn()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"카드 투입 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                if ((res = sdk.Move(SmartComm2Wrapper.CARDPOS_PRINT)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"인쇄 위치 이동 실패 (0x{res:X8})"); Recover(sdk); return 4; }

                if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_FRONT, front)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"앞면 그리기 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                Stage("load");
                Log($"앞면 로드: {Path.GetFileName(front)}");
                if (duplex)
                {
                    if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_BACK, back, backRotate)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"뒷면 그리기 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                    Log($"뒷면 로드: {Path.GetFileName(back)}" + (backRotate != 0 ? $" (회전 {backRotate}도)" : ""));
                }

                sdk.GetRibbonInfo(out int rtype, out int rmax, out int rremain, out _);
                Stage("ribbon");
                Log($"리본: type={rtype} 잔량={rremain}/{rmax}" + (rmax > 0 && rremain <= 0 ? " ⚠ 소진" : ""));

                int side = duplex ? SmartComm2Wrapper.PRINTSIDE_BOTH : SmartComm2Wrapper.PRINTSIDE_FRONT;
                if ((res = sdk.DCLPrint(side)) != SmartComm2Wrapper.SM_SUCCESS) { Err($"인쇄 큐 등록 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                Stage("print");
                Log("앞면 인쇄 중...");
                if ((res = sdk.DoPrint()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"앞면 인쇄 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                if (duplex)
                {
                    Log("뒷면 인쇄 중 (플립)...");
                    if ((res = sdk.DoPrint()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"뒷면 인쇄 실패 (0x{res:X8})"); Recover(sdk); return 4; }
                }
                Stage("eject");
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

        // comm 경로 — 드라이버 모드 + dwPrtSide 강제. 앞/뒤를 그린 뒤 한 번에 인쇄한다.
        private static int PrintViaComm(SmartComm2Wrapper sdk, SmartComm2Wrapper.SMART_PRINTER_ITEM target, string sel, string front, string back, int backRotate)
        {
            int res = sdk.OpenDevice(sel, true);
            if (res != SmartComm2Wrapper.SM_SUCCESS && !string.IsNullOrEmpty(target.id)) res = sdk.OpenDevice(target.id, false);
            if (res != SmartComm2Wrapper.SM_SUCCESS) { Err($"프린터 열기 실패 (0x{res:X8})"); return 3; }
            Stage("connect");
            Log($"프린터 연결(드라이버 모드): {target.name}");
            try
            {
                res = sdk.GetStatus(out long status);
                if (res == SmartComm2Wrapper.SM_SUCCESS)
                {
                    if ((status & SmartComm2Wrapper.S51PS_S_COVEROPENED) != 0) { Err("프린터 커버가 열려 있습니다"); return 3; }
                    if ((status & SmartComm2Wrapper.S51PS_S_CARDEMPTY) != 0) { Err("호퍼에 카드가 없습니다"); return 3; }
                }
                bool duplex = back != null;

                // 양면 강제 — 드라이버 기본 설정과 무관하게 인쇄 직전에 적용한다.
                // 실패해도 인쇄는 계속한다(드라이버 기본 설정이 이미 양면일 수 있다).
                int side = duplex ? SmartComm2Wrapper.PRTSIDE_BOTH : SmartComm2Wrapper.PRTSIDE_FRONT;
                bool sideOk = sdk.ApplyPrintSide(side, out string sideDetail);
                Stage("settings");
                Log($"인쇄 면 설정: {(sideOk ? "적용" : "미적용")} — {sideDetail}");
                if (!sideOk && duplex) Err("경고: 양면 강제 실패 — 드라이버 설정이 단면이면 앞면만 나옵니다");

                if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_FRONT, front)) != SmartComm2Wrapper.SM_SUCCESS)
                { Err($"앞면 그리기 실패 (0x{res:X8})"); return 4; }
                Stage("load");
                Log($"앞면 로드: {Path.GetFileName(front)}");
                if (duplex)
                {
                    if ((res = Draw(sdk, SmartComm2Wrapper.PAGE_BACK, back, backRotate)) != SmartComm2Wrapper.SM_SUCCESS)
                    { Err($"뒷면 그리기 실패 (0x{res:X8})"); return 4; }
                    Log($"뒷면 로드: {Path.GetFileName(back)}" + (backRotate != 0 ? $" (회전 {backRotate}도)" : ""));
                }

                sdk.GetRibbonInfo(out int rtype, out int rmax, out int rremain, out _);
                Stage("ribbon");
                Log($"리본: type={rtype} 잔량={rremain}/{rmax}" + (rmax > 0 && rremain <= 0 ? " ⚠ 소진" : ""));

                Stage("print");

                Log("인쇄 중...");
                if ((res = sdk.Print()) != SmartComm2Wrapper.SM_SUCCESS) { Err($"인쇄 실패 (0x{res:X8})"); return 4; }
                Log(duplex ? "양면 인쇄 완료" : "단면 인쇄 완료");
                return 0;
            }
            finally { sdk.CloseDevice(); }
        }

        // 어떤 포맷/크기든 카드 규격(가로 1012×636 / 세로 636×1012) 24bpp로 리사이즈 후 HBITMAP 전달
        // (SDK 파일 디코더 우회 — 빈 카드 문제 회피)
        private static int Draw(SmartComm2Wrapper sdk, byte page, string path, int rotate = 0)
        {
            using var canvas = ToCardBitmap(path, rotate);
            IntPtr hbmp = canvas.GetHbitmap();
            try { return sdk.DrawBitmap(page, SmartComm2Wrapper.PANEL_COLOR, 0, 0, CARD_W, CARD_H, hbmp, out _); }
            finally { DeleteObject(hbmp); }
        }

        // rotate: 뒷면 전용. 양면 프린터는 플리퍼가 카드를 뒤집는 축에 따라 뒷면 방향이 달라진다.
        //   0   그대로 (기본)
        //   180 위아래 뒤집힘 보정 — 플리퍼가 긴 변을 축으로 뒤집을 때 필요하다
        //   90/270 세로 디자인을 가로 패널에 올릴 때. 비율이 달라지므로 '덮고 잘라내기'로 맞춘다
        private static Bitmap ToCardBitmap(string path, int rotate = 0)
        {
            using var src0 = new Bitmap(path);
            using var src = RotateCopy(src0, rotate);
            var canvas = new Bitmap(CARD_W, CARD_H, System.Drawing.Imaging.PixelFormat.Format24bppRgb);
            using var g = Graphics.FromImage(canvas);
            g.Clear(Color.White);
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            if (rotate == 90 || rotate == 270)
            {
                // 비율이 뒤바뀐 경우엔 늘려 찌그러뜨리지 않고, 카드를 덮도록 키운 뒤 가운데를 쓴다
                double s = Math.Max((double)CARD_W / src.Width, (double)CARD_H / src.Height);
                int w = (int)Math.Ceiling(src.Width * s), h = (int)Math.Ceiling(src.Height * s);
                g.DrawImage(src, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
            }
            else g.DrawImage(src, 0, 0, CARD_W, CARD_H);
            return canvas;
        }

        private static Bitmap RotateCopy(Bitmap src, int deg)
        {
            var b = new Bitmap(src);
            if (deg == 90) b.RotateFlip(RotateFlipType.Rotate90FlipNone);
            else if (deg == 180) b.RotateFlip(RotateFlipType.Rotate180FlipNone);
            else if (deg == 270) b.RotateFlip(RotateFlipType.Rotate270FlipNone);
            return b;
        }

        private static void Recover(SmartComm2Wrapper sdk)
        {
            try { sdk.CardOut(); } catch { }
            try { sdk.ClearStatus(); } catch { }
        }

        private static string Next(string[] a, ref int i) => ++i < a.Length ? a[i] : throw new ArgumentException($"{a[i - 1]} 값 누락");
        // 진행 단계를 기계가 읽을 수 있게 한 줄로 내보낸다.
        // 앱(main.js)이 이걸 화면 문구로 바꾼다 — SMART-81 은 인쇄에 20~40초가 걸려서
        // 타이머로 채우는 진행바로는 실제 진행을 나타낼 수 없다.
        private static void Stage(string key) => Console.WriteLine("##STAGE:" + key);
        private static void Log(string m) => Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {m}");
        private static void Err(string m) => Console.Error.WriteLine($"[{DateTime.Now:HH:mm:ss}] ERROR {m}");
        private static void Usage() => Console.WriteLine("DalsuPrint --front <png> [--back <png>] [--printer <desc>] [--mode comm|dcl] [--portrait|--landscape] [--dry-run] [--list]");
    }
}
