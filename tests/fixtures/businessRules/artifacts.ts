/**
 * Synthetic Business Rules! status-file and source text modeled on the
 * printed layouts of the runtime and its source files. Invented paths and
 * values; no producer content is copied. Ported from Kimi's
 * feat/business-rules-support fixtures.
 */

const DRIVE_COLUMNS_LINE = "Drive   Path            Shared Name  Directory";

/** One drive row aligned to the column header, as in the fixed layout. */
const driveRow = (
  logical: string,
  physical: string,
  shared: string,
  directory: string,
): string => {
  const pathAt = DRIVE_COLUMNS_LINE.indexOf("Path");
  const sharedAt = DRIVE_COLUMNS_LINE.indexOf("Shared Name");
  const directoryAt = DRIVE_COLUMNS_LINE.indexOf("Directory");
  return (
    logical.padEnd(pathAt) +
    physical.padEnd(sharedAt - pathAt) +
    shared.padEnd(directoryAt - sharedAt) +
    directory
  );
};

/** Status/crash file covering every parsed section plus one unknown line. */
export const STATUS_FILE_TEXT = [
  "",
  "",
  "WSID=  7    Date=03/04/1992   Time=01:02:03",
  "",
  "Program ID F:\\root\\LIBRARY\\EXAMPLE.WB",
  "",
  "Current Line=120     Last Error=42     Error Line=610:02",
  "Last OS Error 5",
  "",
  "F:\\root\\PROG1\\MAIN.wb                    MAIN      ACTIVE     RUN      0 LINKS",
  "F:\\root\\LIBRARY\\EXAMPLE.WB               RESIDENT  ACTIVE     END      3 LINKS",
  "",
  "Server File: f:\\root\\wbwin\\wbserver.dat",
  "BR Config File: :F:\\ROOT\\WBWIN\\wbconfig.sys",
  "Workfile path: F:\\root\\",
  "Help path: F:\\root\\",
  "BRCONFIG Drive Assignments:",
  "Logical Physical        WBSERVER.DAT Current",
  DRIVE_COLUMNS_LINE,
  "------- --------------- ------------ ----------------------------------------",
  driveRow("F:", "F:\\", "", "\\root\\"),
  driveRow("N:", "N:\\", "", "\\share\\"),
  "",
  "Open File #  0  :CON:",
  "     Window,  SROW= 1, SCOL= 1, EROW=24, ECOL=80, PARENT=#  0:",
  "",
  "Open File #120  :CON:",
  "     Window, Outin,   SROW= 2, SCOL=30, EROW=11, ECOL=60, PARENT=#  0:",
  "",
  "Number of I/O retries: 2",
  "Mystery trailer line",
  "",
].join("\r\n");

/** Reduced status file without optional sections. */
export const STATUS_FILE_MINIMAL_TEXT =
  "\nWSID= 12    Date=03/04/1992   Time=04:05:06\n\nProgram ID F:\\root\\PROG1\\ONLY.WB\n";

/** Line-numbered BR source exercising labels, continuations and references. */
export const BR_SOURCE_TEXT = [
  "00010 DIM MENU$(1)*80,TITLE$*80",
  '00020 PRINT FIELDS "1,1,CC 80,[S]": "DEMO"',
  '00030 OPEN #1: "NAME=MASTER//6",INTERNAL,OUTIN,RELATIVE IOERR 110',
  '00040 IF CMDKEY<>1 THEN CHAIN "BEGIN/PROG1"',
  "00050 FIX_MASTER: FOR Z=1 TO LREC(1) : LET FNCOM(Z,LREC(1))",
  "00060 IF X=1 THEN !: ",
  '      CHAIN "AFTER" ! continued statement',
  '00070 EXECUTE "SYSTEM"',
  '00080 OPEN #2: "NAME="&TRIM$(FILENAME$)&",SHR",INTERNAL,OUTIN,RELATIVE',
  '00090 LET X=2 ! CHAIN "NOT-A-REFERENCE"',
  "00100 DEF FNCOM(CPOS,LPOS)",
  "00110 LET TOTAL=0",
  "00120 FNEND",
  "00130 DEF LIBRARY FNALT$*80(DUMMY$*80)",
  '00140 library "LIB/UTIL": fnHelp',
  "",
].join("\r\n");

/** Unnumbered procedure script. */
export const PRC_TEXT = [
  "",
  '!IF F$(200)="1" THEN LET STR$(O(44))',
  'IF F$(900)="" AND F$(200)="1" THEN LET T(1)=(O(44)+O(227)+70)',
  'EXECUTE "PROC NEXT"',
  "LET FnScript=T(1)",
  "",
].join("\r\n");

/** WBCONFIG.SYS-style runtime configuration with comments and blank lines. */
export const CONFIG_TEXT = [
  "SETENV WBCONFIG 9.1J.001",
  "",
  "REM -- a comment",
  "S/23-DRIVES HBCDFIKLM",
  "APPLICATION_NAME CM 9.1 - Starting Up",
  "WSID 900+",
  "KEYBOARD 7200,0010         ; Control Print Screen is ^P",
  "",
].join("\r\n");

/**
 * SCREEN.* fixed-record bytes: no verified signature, so observation is
 * identity and classification only. Deliberately not plain text.
 */
export const SCREEN_BYTES = Buffer.from([
  0x4d, 0x45, 0x4e, 0x55, 0x00, 0x01, 0x18, 0x50, 0x02, 0x0f, 0xff, 0x00, 0x44,
  0x41, 0x54, 0x41, 0x00, 0x00,
]);

/**
 * Signature-only containers for the compiled-program structural observation:
 * they carry the header variant magic and crafted byte patterns but are not
 * decodable by the full container layout checks. Variant names follow the
 * decoder: "modern" is the 51-byte big-endian header, "legacy" the 30/32-byte
 * little-endian one.
 */

/** Minimal legacy container with two line records and a string run. */
export const legacyObservationProgram = (): Buffer => {
  const header = Buffer.alloc(48);
  header.writeUInt32LE(64, 0);
  header.writeUInt32LE(0, 4);
  header[8] = 0x0a;
  header[9] = 0x1f;
  header[10] = 0x02;
  header[11] = 0xa0;
  header[12] = 0x01;
  header[13] = 0x18;
  header.writeUInt32LE(96, 16);
  header.writeUInt32LE(30, 20);
  const text = Buffer.from("DIM FLAG,TOTAL", "ascii");
  return Buffer.concat([
    header,
    Buffer.from([0x02]),
    Buffer.from("00010", "ascii"),
    Buffer.from([0x01, 0x0b, 0x05, text.length]),
    text,
    Buffer.from([0x00, 0x03, 0x00, 0x4b, 0x40, 0x10, 0x00]),
    Buffer.from([0x01]),
    Buffer.from("00020", "ascii"),
    Buffer.from([0x01, 0x0c]),
    Buffer.from('"1,1,C 8,[S]"', "ascii"),
    Buffer.from([0x00]),
  ]);
};

/** Minimal modern container with a line-number reset (two segments). */
export const modernObservationProgram = (): Buffer => {
  const header = Buffer.alloc(48);
  header.set([0x00, 0x00, 0x00, 0x33], 0);
  header.writeUInt32BE(0x00000100, 4);
  header.set([0x0c, 0x26, 0x03], 8);
  header[11] = 0xa0;
  header[46] = 0x01;
  header[47] = 0x18;
  return Buffer.concat([
    header,
    Buffer.from([0x01]),
    Buffer.from("00070", "ascii"),
    Buffer.from([0x07, 0x00]),
    Buffer.from([0x02]),
    Buffer.from("00090", "ascii"),
    Buffer.from([0x00]),
    Buffer.from([0x01]),
    Buffer.from("00010", "ascii"),
    Buffer.from([0x00]),
  ]);
};
