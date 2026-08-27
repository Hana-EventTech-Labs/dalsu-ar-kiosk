using System;
using System.Runtime.InteropServices;
using System.Text;

namespace SmartNfcWriter
{
    /// <summary>
    /// SmartComm2.dll P/Invoke 래퍼
    /// Smart-51D 카드 프린터 SDK 연동
    /// </summary>
    public class SmartComm2Wrapper : IDisposable
    {
        private IntPtr _hDll = IntPtr.Zero;
        private IntPtr _hSmart = IntPtr.Zero;
        private bool _disposed;

        // Return codes
        public const int SM_SUCCESS = 0;
        public const int SM_FAIL = -1;

        // Card positions
        public const int CARDPOS_PRINT = 0;
        public const int CARDPOS_MAGNETIC = 1;
        public const int CARDPOS_RF2 = 6;
        public const int CARDPOS_IC2 = 7;

        // RF device
        public const int RF_DEV_INTERNAL = 1;
        public const int RF_DEV_EXTERNAL = 2;
        // DUALi(DE-ABCM) 독자 프로토콜은 nDev=-1로 호출 (SDK 공식 샘플 근거)
        public const int RF_DEV_DUALI = -1;

        // Open device type
        public const int SMART_OPENDEVICE_BYID = 0;
        public const int SMART_OPENDEVICE_BYDESC = 1;

        // Page/Panel
        public const byte PAGE_FRONT = 0;
        public const byte PAGE_BACK = 1;
        public const byte PANEL_COLOR = 1;
        public const byte PANEL_BLACK = 2;

        // Print side (SmartDCL_Print nPrintSide) — SmartComm2.dll.h 685-688.
        // 공식 샘플(SmartCommonTestDlg.cpp:834)은 양면에 SMART_PRINTSIDE_BOTH=1 사용.
        // (매뉴얼은 51용 2를 안내하나, 실장비에선 2가 빈 카드/no-op, 1이 정상 인쇄)
        public const int PRINTSIDE_FRONT = 0;
        public const int PRINTSIDE_BOTH  = 1;

        // SMART-51 printer status bits (SmartComm2.dll.h)
        public const long S51PS_S_CONNLAMINATOR = 0x0000000000004000;
        public const long S51PS_S_CONNFLIPPER   = 0x0000000000008000;
        public const long S51PS_S_COVEROPENED   = 0x0000000000020000; // 헤더 326
        public const long S51PS_S_CARDEMPTY     = 0x0000000000100000; // 헤더 329

        // 양면 강제 — 프린터 설정(SMART81_DEVMODE)의 dwPrtSide 를 직접 패치한다.
        //   SMART81_DEVMODE = { DEVMODEW devmode; OEMDEV81 oemdev; }  (중간 reserved 없음)
        //   sizeof(OEMDEV81)=12976, OEMDEV81 내 dwPrtSide 오프셋=164
        //   → 버퍼 내 오프셋 = (len - 12976) + 164.  값: 0=앞면, 2=양면(SMART-51/81)
        // 근거: 라테일 팝업스토어 03-character-card-kiosk/printer.js — 실장비 양면 출력 확인됨(2026-06).
        public const int SIZEOF_OEMDEV81 = 12976;
        public const int OEMDEV81_DWPRTSIDE = 164;
        public const int PRTSIDE_FRONT = 0;
        public const int PRTSIDE_BOTH = 2;

        // Orientation (Windows DEVMODE 표준값)
        public const int DMORIENT_PORTRAIT  = 1;
        public const int DMORIENT_LANDSCAPE = 2;

        #region Native Structures

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_PORT_USB
        {
            public int vid;
            public int pid;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string serial;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_PORT_NET
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string ip;
            public int port;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string mac;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_STANDARD
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
            public string name;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string id;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string dev;
            public int dev_type;
            public int pid;
            public SMART_PRINTER_PORT_USB usb;
            public SMART_PRINTER_PORT_NET net;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_OPTIONS
        {
            public int is_dual;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string ic1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string ic2;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string rf1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
            public string rf2;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_INFO
        {
            public SMART_PRINTER_STANDARD std;
            public SMART_PRINTER_OPTIONS opt;
        }

        // 네이티브 SMART_PRINTER_ITEM(SmartComm2.dll.h)과 정확히 일치.
        // GetDeviceList2가 채우는 항목 구조체 — name/id/dev/desc + pid.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_ITEM
        {
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string name;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]  public string id;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]  public string dev;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string desc;
            public int pid;
        }

        // 네이티브: { int n; SMART_PRINTER_ITEM item[MAX_SMART_PRINTER(32)]; }
        // 기존엔 item 타입을 거대한 SMART_PRINTER_INFO·크기 16으로 잘못 선언해
        // item[1]부터 오프셋이 어긋나 둘째 프린터가 보이지 않았다.
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct SMART_PRINTER_LIST
        {
            public int count;   // 네이티브 n
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 32)]
            public SMART_PRINTER_ITEM[] item;
        }

        #endregion

        #region Delegate Definitions

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_GetDeviceList2(ref SMART_PRINTER_LIST pDevList);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_OpenDevice2(ref IntPtr phsmart, string szdev, int ndevtype);

        // SmartComm_GetDeviceInfo2(SMART_PRINTER_INFO* pDevInfo, WCHAR* szdev, int ndevtype)
        // 선택 프린터의 옵션(opt.rf1 = RF 리더 모델명)을 읽는 데 사용.
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_GetDeviceInfo2(ref SMART_PRINTER_INFO info, string szdev, int ndevtype);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_CloseDevice(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_GetStatus(IntPtr hsmart, ref long piStatus);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_GetRibbonInfo(IntPtr hsmart, ref int ptype, ref int pmax, ref int premain, ref int pgrade);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_SBSStart(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_SBSEnd(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_CardIn(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_CardOut(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_Move(IntPtr hsmart, int pos);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_DoPrint(IntPtr hsmart);
        // SmartComm_GetPrinterSettings2(HSMART, void* pDm, int* plen) / SetPrinterSettings2(HSMART, void* pDm, int len)
        private delegate int D_GetPrinterSettings2(IntPtr hsmart, IntPtr pDm, ref int plen);
        private delegate int D_SetPrinterSettings2(IntPtr hsmart, IntPtr pDm, int len);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_DrawText(IntPtr hsmart, byte page, byte panel,
            int x, int y, string szFontName, int nFontSize, byte nFontStyle,
            string szText, ref RECT prcArea);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_DrawImage(IntPtr hsmart, byte page, byte panel,
            int x, int y, int cx, int cy, string szImgPath, ref RECT prcArea);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_DrawBitmap(IntPtr hsmart, byte page, byte panel,
            int x, int y, int cx, int cy, IntPtr hbmp, ref RECT prcArea);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_RFPowerOn(IntPtr hsmart, int nDev, ref int pnCardType,
            ref uint pdwOutLen, byte[] pOutBuf);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_RFPowerOff(IntPtr hsmart, int nDev);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_RFTransmit(IntPtr hsmart, int nDev,
            uint dwInLen, byte[] pInBuf, ref uint pdwOutLen, byte[] pOutBuf);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_RFPCSC_GetReaderName(IntPtr hsmart, int nWhich, StringBuilder szName);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_ClearStatus(IntPtr hsmart);

        // DCL mode delegates
        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_DCLOpenDevice2(ref IntPtr phsmart, string szdev, int ndevtype, int nOrientation);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_DCLCloseDevice(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_DCLPrint(IntPtr hsmart, int nPrintSide);

        [UnmanagedFunctionPointer(CallingConvention.Winapi, CharSet = CharSet.Unicode)]
        private delegate int D_OpenDocument(IntPtr hsmart, string szCSDName);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_CloseDocument(IntPtr hsmart);

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        private delegate int D_Print(IntPtr hsmart);

        #endregion

        #region Function Pointers

        private D_GetDeviceList2 _getDeviceList2;
        private D_OpenDevice2 _openDevice2;
        private D_GetDeviceInfo2 _getDeviceInfo2;
        private D_CloseDevice _closeDevice;
        private D_GetStatus _getStatus;
        private D_GetRibbonInfo _getRibbonInfo;
        private D_SBSStart _sbsStart;
        private D_SBSEnd _sbsEnd;
        private D_CardIn _cardIn;
        private D_CardOut _cardOut;
        private D_Move _move;
        private D_DoPrint _doPrint;
        private D_GetPrinterSettings2 _getPrinterSettings2;
        private D_SetPrinterSettings2 _setPrinterSettings2;
        private D_DrawText _drawText;
        private D_DrawImage _drawImage;
        private D_DrawBitmap _drawBitmap;
        private D_RFPowerOn _rfPowerOn;
        private D_RFPowerOff _rfPowerOff;
        private D_RFTransmit _rfTransmit;
        private D_RFPCSC_GetReaderName _rfpcscGetReaderName;
        private D_ClearStatus _clearStatus;
        private D_DCLOpenDevice2 _dclOpenDevice2;
        private D_DCLCloseDevice _dclCloseDevice;
        private D_DCLPrint _dclPrint;
        private D_OpenDocument _openDocument;
        private D_CloseDocument _closeDocument;
        private D_Print _print;

        #endregion

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern IntPtr LoadLibrary(string lpFileName);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool FreeLibrary(IntPtr hModule);

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)]
        private static extern IntPtr GetProcAddress(IntPtr hModule, string lpProcName);

        public bool IsLoaded => _hDll != IntPtr.Zero;
        public bool IsOpened => _hSmart != IntPtr.Zero;

        public bool Load(string dllPath)
        {
            _hDll = LoadLibrary(dllPath);
            if (_hDll == IntPtr.Zero)
                return false;

            _getDeviceList2 = GetFunc<D_GetDeviceList2>("SmartComm_GetDeviceList2");
            _openDevice2 = GetFunc<D_OpenDevice2>("SmartComm_OpenDevice2");
            _getDeviceInfo2 = GetFunc<D_GetDeviceInfo2>("SmartComm_GetDeviceInfo2");
            _closeDevice = GetFunc<D_CloseDevice>("SmartComm_CloseDevice");
            _getStatus = GetFunc<D_GetStatus>("SmartComm_GetStatus");
            _getRibbonInfo = GetFunc<D_GetRibbonInfo>("SmartComm_GetRibbonInfo");
            _sbsStart = GetFunc<D_SBSStart>("SmartComm_SBSStart");
            _sbsEnd = GetFunc<D_SBSEnd>("SmartComm_SBSEnd");
            _cardIn = GetFunc<D_CardIn>("SmartComm_CardIn");
            _cardOut = GetFunc<D_CardOut>("SmartComm_CardOut");
            _move = GetFunc<D_Move>("SmartComm_Move");
            _doPrint = GetFunc<D_DoPrint>("SmartComm_DoPrint");
            _getPrinterSettings2 = GetFunc<D_GetPrinterSettings2>("SmartComm_GetPrinterSettings2");
            _setPrinterSettings2 = GetFunc<D_SetPrinterSettings2>("SmartComm_SetPrinterSettings2");
            _drawText = GetFunc<D_DrawText>("SmartComm_DrawText");
            _drawImage = GetFunc<D_DrawImage>("SmartComm_DrawImage");
            _drawBitmap = GetFunc<D_DrawBitmap>("SmartComm_DrawBitmap");
            _rfPowerOn = GetFunc<D_RFPowerOn>("SmartComm_RFPowerOn");
            _rfPowerOff = GetFunc<D_RFPowerOff>("SmartComm_RFPowerOff");
            _rfTransmit = GetFunc<D_RFTransmit>("SmartComm_RFTransmit");
            _rfpcscGetReaderName = GetFunc<D_RFPCSC_GetReaderName>("SmartCommEx_RFPCSC_GetReaderName");
            _clearStatus = GetFunc<D_ClearStatus>("SmartComm_ClearStatus");
            _dclOpenDevice2 = GetFunc<D_DCLOpenDevice2>("SmartDCL_OpenDevice2");
            _dclCloseDevice = GetFunc<D_DCLCloseDevice>("SmartDCL_CloseDevice");
            _dclPrint = GetFunc<D_DCLPrint>("SmartDCL_Print");
            _openDocument = GetFunc<D_OpenDocument>("SmartComm_OpenDocument");
            _closeDocument = GetFunc<D_CloseDocument>("SmartComm_CloseDocument");
            _print = GetFunc<D_Print>("SmartComm_Print");

            return true;
        }

        private T GetFunc<T>(string name) where T : Delegate
        {
            IntPtr ptr = GetProcAddress(_hDll, name);
            if (ptr == IntPtr.Zero) return null;
            return Marshal.GetDelegateForFunctionPointer<T>(ptr);
        }

        public void Free()
        {
            if (_hDll != IntPtr.Zero)
            {
                FreeLibrary(_hDll);
                _hDll = IntPtr.Zero;
            }
        }

        #region Printer Control

        public int GetDeviceList(out SMART_PRINTER_LIST list)
        {
            list = new SMART_PRINTER_LIST
            {
                item = new SMART_PRINTER_ITEM[32]
            };
            return _getDeviceList2(ref list);
        }

        public int OpenDevice(string deviceDesc, bool byDesc = true)
        {
            int type = byDesc ? SMART_OPENDEVICE_BYDESC : SMART_OPENDEVICE_BYID;
            return _openDevice2(ref _hSmart, deviceDesc, type);
        }

        /// <summary>DCL 모드로 장치를 연다. orientation 은 DMORIENT_PORTRAIT(세로) / DMORIENT_LANDSCAPE(가로).</summary>
        public int OpenDeviceDCL(string deviceDesc, bool byDesc = true, int orientation = DMORIENT_LANDSCAPE)
        {
            int type = byDesc ? SMART_OPENDEVICE_BYDESC : SMART_OPENDEVICE_BYID;
            return _dclOpenDevice2(ref _hSmart, deviceDesc, type, orientation);
        }

        /// <summary>
        /// 디바이스 정보 조회 — opt.rf1(RF 리더 모델명) 등을 읽는다.
        /// dev: 프린터 식별자(desc 또는 id), devType: SMART_OPENDEVICE_BYDESC/BYID.
        /// </summary>
        public int GetDeviceInfo2(out SMART_PRINTER_INFO info, string dev, int devType)
        {
            info = new SMART_PRINTER_INFO();
            if (_getDeviceInfo2 == null) return SM_FAIL;
            return _getDeviceInfo2(ref info, dev, devType);
        }

        public int CloseDevice()
        {
            if (_hSmart == IntPtr.Zero) return SM_SUCCESS;
            int res = _closeDevice(_hSmart);
            _hSmart = IntPtr.Zero;
            return res;
        }

        public int CloseDeviceDCL()
        {
            if (_hSmart == IntPtr.Zero) return SM_SUCCESS;
            int res = _dclCloseDevice(_hSmart);
            _hSmart = IntPtr.Zero;
            return res;
        }

        public int GetStatus(out long status)
        {
            status = 0;
            return _getStatus(_hSmart, ref status);
        }

        public int GetRibbonInfo(out int type, out int max, out int remain, out int grade)
        {
            type = 0; max = 0; remain = 0; grade = 0;
            return _getRibbonInfo(_hSmart, ref type, ref max, ref remain, ref grade);
        }

        public int SBSStart() => _sbsStart(_hSmart);
        public int SBSEnd() => _sbsEnd(_hSmart);
        public int CardIn() => _cardIn(_hSmart);
        public int CardOut() => _cardOut(_hSmart);
        public int Move(int pos) => _move(_hSmart, pos);
        public int DoPrint() => _doPrint(_hSmart);
        public int ClearStatus() => _clearStatus(_hSmart);

        public int DrawText(byte page, byte panel, int x, int y,
            string fontName, int fontSize, byte fontStyle, string text, out RECT area)
        {
            area = new RECT();
            return _drawText(_hSmart, page, panel, x, y, fontName, fontSize, fontStyle, text, ref area);
        }

        public int DrawImage(byte page, byte panel, int x, int y, int cx, int cy, string imgPath, out RECT area)
        {
            area = new RECT();
            return _drawImage(_hSmart, page, panel, x, y, cx, cy, imgPath, ref area);
        }

        public int DrawBitmap(byte page, byte panel, int x, int y, int cx, int cy, IntPtr hbmp, out RECT area)
        {
            area = new RECT();
            return _drawBitmap(_hSmart, page, panel, x, y, cx, cy, hbmp, ref area);
        }

        public int Print() => _print(_hSmart);

        /// <summary>
        /// 인쇄 면을 프린터 설정에 강제 적용한다(0=앞면, 2=양면). 성공 시 true.
        /// 구조가 예상과 다르면(다른 모델 등) **건드리지 않고** false 를 돌려준다 — 잘못 쓰면 설정이 깨진다.
        /// </summary>
        public bool ApplyPrintSide(int side, out string detail)
        {
            detail = "";
            int len = 0;
            int r = _getPrinterSettings2(_hSmart, IntPtr.Zero, ref len);
            if (r != SM_SUCCESS || len <= 0) { detail = $"설정 길이 조회 실패 (0x{r:X8}, len={len})"; return false; }

            int devmodeSize = len - SIZEOF_OEMDEV81;
            int off = devmodeSize + OEMDEV81_DWPRTSIDE;
            if (devmodeSize < 150 || devmodeSize > 400 || off + 4 > len)
            {
                detail = $"레이아웃 불일치 — 미적용 (len={len}, devmode={devmodeSize})";
                return false;
            }

            IntPtr buf = Marshal.AllocHGlobal(len);
            try
            {
                int l2 = len;
                if ((r = _getPrinterSettings2(_hSmart, buf, ref l2)) != SM_SUCCESS)
                { detail = $"설정 읽기 실패 (0x{r:X8})"; return false; }

                byte[] tmp = new byte[len];
                Marshal.Copy(buf, tmp, 0, len);
                uint cur = BitConverter.ToUInt32(tmp, off);
                if (cur > 3) { detail = $"면 값이 비정상({cur}) — 오프셋 의심, 미적용"; return false; }

                BitConverter.GetBytes((uint)side).CopyTo(tmp, off);
                Marshal.Copy(tmp, 0, buf, len);
                r = _setPrinterSettings2(_hSmart, buf, len);
                detail = r == SM_SUCCESS ? $"dwPrtSide {cur}→{side} 적용" : $"설정 쓰기 실패 (0x{r:X8})";
                return r == SM_SUCCESS;
            }
            finally { Marshal.FreeHGlobal(buf); }
        }

        public int DCLPrint(int printSide) => _dclPrint(_hSmart, printSide);

        #endregion

        #region RF (NFC) Control

        public int RFPowerOn(int nDev, out int cardType, out byte[] atr)
        {
            cardType = 0;
            uint outLen = 256;
            atr = new byte[256];
            int res = _rfPowerOn(_hSmart, nDev, ref cardType, ref outLen, atr);
            if (res == SM_SUCCESS && outLen < 256)
                Array.Resize(ref atr, (int)outLen);
            return res;
        }

        public int RFPowerOff(int nDev) => _rfPowerOff(_hSmart, nDev);

        public int RFTransmit(int nDev, byte[] sendData, out byte[] recvData)
        {
            uint recvLen = 256;
            recvData = new byte[256];
            int res = _rfTransmit(_hSmart, nDev, (uint)sendData.Length, sendData, ref recvLen, recvData);
            if (res == SM_SUCCESS && recvLen < 256)
                Array.Resize(ref recvData, (int)recvLen);
            return res;
        }

        public int GetRFReaderName(int which, out string name)
        {
            var sb = new StringBuilder(256);
            int res = _rfpcscGetReaderName(_hSmart, which, sb);
            name = sb.ToString();
            return res;
        }

        #endregion

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            if (_hSmart != IntPtr.Zero)
            {
                try { _sbsEnd?.Invoke(_hSmart); } catch { }
                try { _closeDevice?.Invoke(_hSmart); } catch { }
                _hSmart = IntPtr.Zero;
            }

            Free();
        }
    }
}
