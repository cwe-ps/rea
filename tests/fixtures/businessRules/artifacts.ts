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
