/**
 * Execution-stream vocabulary observed by aligning compiled instructions with
 * saved LIST text across a reference corpus. Codes are the six-bit opcodes of
 * the stack machine (statement ops reuse the saved-LIST statement codes; clause
 * ops use the saved-LIST clause codes masked to six bits).
 */

/** Statement opcodes and their keywords. */
export const EXEC_STATEMENTS: ReadonlyMap<number, string> = new Map([
  [1, "LET"],
  [2, "MAT"],
  [3, "REM"],
  [4, "PAUSE"],
  [6, "RANDOMIZE"],
  [7, "OPTION"],
  [11, "DIM"],
  [12, "DATA"],
  [13, "LIBRARY"],
  [16, "DISPLAY"],
  [17, "RESTORE"],
  [18, "OPEN"],
  [19, "CLOSE"],
  [20, "READ"],
  [21, "WRITE"],
  [22, "REREAD"],
  [23, "REWRITE"],
  [24, "PRINT"],
  [25, "INPUT"],
  [26, "LINPUT"],
  [27, "RINPUT"],
  [28, "DELETE"],
  [29, "UNLOCK"],
  [30, "FORM"],
  [32, "GOSUB"],
  [33, "RETURN"],
  [34, "FOR"],
  [35, "NEXT"],
  [38, "DEF"],
  [39, "FNEND"],
  [40, "IF"],
  [41, "ON"],
  [42, "CONTINUE"],
  [43, "RETRY"],
  [44, "GOTO"],
  [45, "EXIT"],
  [46, "STOP"],
  [47, "END"],
  [49, "CHAIN"],
  [54, "EXECUTE"],
  [55, "SYSTEM"],
  [56, "IGNORE"],
  [59, "DO"],
  [62, "LOOP"],
]);

/** Binary expression opcodes. */
export const EXEC_BINARY: ReadonlyMap<number, string> = new Map([
  [0x07, "**"],
  [0x08, "*"],
  [0x09, "/"],
  [0x0b, "+"],
  [0x0c, "-"],
  [0x0f, "&"],
  [0x11, ">"],
  [0x12, "<"],
  [0x13, ">="],
  [0x14, "<="],
  [0x15, "<>"],
  [0x16, "="],
  [0x0d, ":="],
  [0x1b, "+="],
  [0x1c, "-="],
  [0x18, "*="],
  [0x19, "/="],
]);

/** Binding strength used to emit minimal parentheses. */
export const EXEC_PRECEDENCE: ReadonlyMap<string, number> = new Map([
  ["**", 7],
  ["*", 6],
  ["/", 6],
  ["+", 5],
  ["-", 5],
  ["&", 5],
  [">", 4],
  ["<", 4],
  [">=", 4],
  ["<=", 4],
  ["<>", 4],
  ["=", 4],
  [":=", 1],
  ["+=", 1],
  ["-=", 1],
  ["*=", 1],
  ["/=", 1],
]);

/** Precedence of an operand that never needs parentheses. */
export const ATOM = 9;

/** Internal name of the substring builtin, rendered as `A$(lo:hi)`. */
export const SUBSTRING_BUILTIN = "<SUBSTR>";

/** Builtin functions and system values, keyed by call op (0x21 string, 0x22 numeric) and id. */
export const EXEC_BUILTINS: ReadonlyMap<number, string> = new Map(
  (
    [
      [0x22, 0x22, "ORD"],
      [0x21, 0x15, "SYSERR$"],
      [0x21, 0x71, "BR_FILENAME$"],
      [0x21, 0x03, "VARIABLE$"],
      [0x22, 0x41, "FREESP"],
      [0x22, 0x16, "SYSERR"],
      [0x21, 0x16, "BRERR$"],
      [0x22, 0x00, "CODE"],
      [0x22, 0x36, "COS"],
      [0x22, 0x37, "SIN"],
      [0x22, 0x38, "ATN"],
      [0x22, 0x39, "SQR"],
      [0x22, 0x0b, "PI"],
      [0x22, 0x1c, "CURPOS"],
      [0x21, 0x77, "BR_DATE$"],
      [0x21, 0x00, "KSTAT$"],
      [0x21, 0x01, "WSID$"],
      [0x21, 0x04, "PROGRAM$"],
      [0x21, 0x05, "SESSION$"],
      [0x21, 0x06, "WBVERSION$"],
      [0x21, 0x07, "WBPLATFORM$"],
      [0x21, 0x0e, "BELL"],
      [0x21, 0x0f, "NEWPAGE"],
      [0x21, 0x11, "DATE$"],
      [0x21, 0x12, "TIME$"],
      [0x21, 0x13, "MENU$"],
      [0x21, 0x14, "LOGIN_NAME$"],
      [0x21, 0x20, "LTRM$"],
      [0x21, 0x21, "RTRM$"],
      [0x21, 0x22, "HEX$"],
      [0x21, 0x23, "UNHEX$"],
      [0x21, 0x24, "UPRC$"],
      [0x21, 0x25, "LWRC$"],
      [0x21, 0x26, "MSG$"],
      [0x21, 0x28, "CFORM$"],
      [0x21, 0x2a, "ENV$"],
      [0x21, 0x2c, "TRIM$"],
      [0x21, 0x30, "STR$"],
      [0x21, 0x31, "CHR$"],
      [0x21, 0x40, "FILE$"],
      [0x21, 0x50, "RPT$"],
      [0x21, 0x51, "LPAD$"],
      [0x21, 0x52, "RPAD$"],
      [0x21, 0x53, "HELP$"],
      [0x21, 0x60, "SREP$"],
      [0x21, 0x61, "XLATE$"],
      [0x21, 0x64, SUBSTRING_BUILTIN],
      [0x21, 0x65, "CNVRT$"],
      [0x21, 0x70, "OS_FILENAME$"],
      [0x22, 0x01, "ERR"],
      [0x22, 0x02, "LINE"],
      [0x22, 0x03, "SERIAL"],
      [0x22, 0x04, "CNT"],
      [0x22, 0x05, "CMDKEY"],
      [0x22, 0x06, "FILENUM"],
      [0x22, 0x08, "CURROW"],
      [0x22, 0x09, "CURCOL"],
      [0x22, 0x0a, "INF"],
      [0x22, 0x0c, "CURFLD"],
      [0x22, 0x0d, "FKEY"],
      [0x22, 0x12, "RND"],
      [0x22, 0x13, "MENU"],
      [0x22, 0x14, "TIMER"],
      [0x22, 0x15, "NXTFLD"],
      [0x22, 0x17, "SCR_FREEZE"],
      [0x22, 0x18, "SCR_THAW"],
      [0x22, 0x19, "NXTROW"],
      [0x22, 0x1a, "NXTCOL"],
      [0x22, 0x1b, "CURWINDOW"],
      [0x22, 0x20, "LEN"],
      [0x22, 0x21, "VAL"],
      [0x22, 0x24, "EXISTS"],
      [0x22, 0x25, "SETENV"],
      [0x22, 0x30, "CEIL"],
      [0x22, 0x32, "IP"],
      [0x22, 0x33, "FP"],
      [0x22, 0x3d, "SLEEP"],
      [0x22, 0x3e, "CURTAB"],
      [0x22, 0x40, "FILE"],
      [0x22, 0x42, "KLN"],
      [0x22, 0x43, "KPS"],
      [0x22, 0x44, "REC"],
      [0x22, 0x45, "RLN"],
      [0x22, 0x46, "LREC"],
      [0x22, 0x47, "KREC"],
      [0x22, 0x4a, "VERSION"],
      [0x22, 0x60, "MIN"],
      [0x22, 0x61, "MAX"],
      [0x22, 0x62, "ROUND"],
      [0x22, 0x63, "REM"],
      [0x22, 0x64, "MOD"],
      [0x22, 0x66, "POS"],
      [0x22, 0x67, "DATE"],
      [0x22, 0x68, "DAYS"],
      [0x22, 0x6a, "MSGBOX"],
      [0x22, 0x6b, "DEBUG_STR"],
      [0x22, 0x70, "UDIM"],
      [0x22, 0x71, "SRCH"],
      [0x22, 0x72, "SUM"],
      [0x22, 0x73, "PRINTER_LIST"],
      [0x22, 0x74, "STR2MAT"],
      [0x22, 0x75, "MAT2STR"],
      [0x22, 0x81, "MSG"],
    ] as const
  ).map(([op, id, name]) => [builtinKey(op, id), name]),
);

/** Map key for a builtin id within its call-op namespace. */
export function builtinKey(op: number, id: number): number {
  return op * 0x10000 + id;
}

/** Clause opcodes (saved-LIST clause codes masked to six bits). */
export const EXEC_CLAUSES: ReadonlyMap<number, string> = new Map([
  [0x00, "BASE"],
  [0x0b, "SELECT"],
  [0x0c, "WAIT="],
  [0x0d, "EXTERNAL"],
  [0x0e, "ATTR"],
  [0x0f, "BORDER"],
  [0x11, "USING"],
  [0x12, "USING"],
  [0x13, "FIELDS"],
  [0x15, "DROP"],
  [0x16, "FREE"],
  [0x17, "RELEASE"],
  [0x18, "DISPLAY"],
  [0x19, "INTERNAL"],
  [0x1a, "INPUT"],
  [0x1b, "OUTPUT"],
  [0x1c, "OUTIN"],
  [0x1d, "SEQUENTIAL"],
  [0x1e, "RELATIVE"],
  [0x1f, "KEYED"],
  [0x26, "FKEY"],
  [0x27, "RESERVE"],
  [0x2f, "RETAIN"],
  [0x30, "KEY="],
  [0x31, "KEY>="],
  [0x32, "SEARCH="],
  [0x33, "SEARCH>="],
  [0x34, "REC="],
  [0x35, "POS="],
  [0x20, "SOFLOW"],
  [0x21, "CONV"],
  [0x23, "HELP"],
  [0x24, "ZDIV"],
  [0x28, "ERROR"],
  [0x29, "TO"],
  [0x2a, "STEP"],
  [0x2b, "LOCKED"],
  [0x2e, "NONE"],
  [0x38, "EOF"],
  [0x39, "IOERR"],
  [0x3a, "NOKEY"],
  [0x3b, "NOREC"],
  [0x3c, "DUPREC"],
  [0x3d, "PAGEOFLOW"],
  [0x3e, "TIMEOUT"],
]);

/** I/O statement opcodes rendered by the shared channel/clause/list decoder. */
export const EXEC_IO_STATEMENTS: ReadonlySet<number> = new Set([
  0x0d, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
  0x1c, 0x1d,
]);

/** Error clauses whose operand is a jump target (or IGNORE/SYSTEM). */
export const EXEC_ERROR_CLAUSES: ReadonlySet<number> = new Set([
  0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x28, 0x21, 0x20, 0x24, 0x2b,
]);

/** Clauses that consume one statement-header expression. */
export const EXEC_ARGUMENT_CLAUSES: ReadonlyMap<number, string> = new Map([
  [0x13, "FIELDS"],
  [0x0b, "SELECT"],
  [0x12, "USING"],
  [0x30, "KEY="],
  [0x31, "KEY>="],
  [0x32, "SEARCH="],
  [0x33, "SEARCH>="],
  [0x34, "REC="],
  [0x35, "POS="],
  [0x0e, "ATTR"],
  [0x0c, "WAIT="],
  [0x23, "HELP"],
  [0x0f, "BORDER"],
]);

/** Record-position clauses of READ/REREAD. */
export const EXEC_POSITION_CLAUSES: ReadonlyMap<number, string> = new Map([
  [0x2a, "FIRST"],
  [0x2c, "LAST"],
  [0x2d, "NEXT"],
  [0x2e, "PRIOR"],
  [0x26, "SAME"],
  [0x27, "RESERVE"],
]);

/** ON-condition clause codes. */
export const EXEC_ON_CONDITIONS: ReadonlyMap<number, string> = new Map([
  [0x28, "ERROR"],
  [0x20, "SOFLOW"],
  [0x21, "CONV"],
  [0x24, "ZDIV"],
  [0x26, "FKEY"],
  [0x3d, "PAGEOFLOW"],
  [0x2b, "LOCKED"],
  [0x22, "OFLOW"],
  [0x25, "ATTN"],
  [0x23, "HELP"],
]);

/** Compiled FORM item types. */
export const EXEC_FORM_ITEMS: ReadonlyMap<number, string> = new Map([
  [1, "POS"],
  [2, "X"],
  [3, "SKIP"],
  [6, "PIC"],
  [8, "V"],
  [9, "C"],
  [10, "CC"],
  [11, "CR"],
  [12, "CU"],
  [13, "CL"],
  [14, "CCU"],
  [15, "CRU"],
  [16, "GZ"],
  [17, "N"],
  [18, "G"],
  [19, "PD"],
  [20, "ZD"],
  [21, "B"],
  [22, "BL"],
  [23, "BH"],
  [24, "L"],
  [25, "NZ"],
  [26, "D"],
  [27, "S"],
]);

/** FORM item types whose length is a plain character count. */
export const EXEC_FORM_STRING_ITEMS: ReadonlySet<number> = new Set([
  8, 9, 10, 11, 12, 13, 14, 15,
]);

/** Words rendered lowercase as keywords in execution-stream output. */
export const EXEC_KEYWORD_WORDS: ReadonlySet<string> = new Set(
  `AND ATTR BASE BORDER BUTTONS CHAIN CLOSE CONTINUE CONV DATA DEF DELETE DIM
  DISPLAY DO DROP DUPREC ELSE END EOF ERROR EXECUTE EXIT EXTERNAL FIELDS FIRST
  FKEY FNEND FOR FORM FREE GOSUB GOTO HELP IF IGNORE INPUT INTERNAL IOERR KEYED
  LAST LET LIBRARY LINPUT LOCKED LOOP MAT MENU NEXT NOKEY NONE NOREC NOT ON OPEN
  OPTION OR OUTIN OUTPUT PAGEOFLOW PAUSE PIC POS PRINT PRIOR RANDOMIZE READ
  RELATIVE RELEASE REM REREAD RESERVE RESTORE RETAIN RETRY RETURN REWRITE RINPUT
  SAME SELECT SEQUENTIAL SKIP SOFLOW SQL STEP STOP SYSTEM THEN TIMEOUT TO UNLOCK
  UNTIL USING WHILE WRITE ZDIV`.split(/\s+/u),
);

/** Builtin function names rendered lowercase in execution-stream output. */
export const EXEC_BUILTIN_WORDS: ReadonlySet<string> = new Set(
  `abs aidx and atn bell ceil cform$ chr$ cmdkey cnt cnvrt$ code cos curcol
  curfld currow date date$ days debug_str decrypt$ didx encrypt$ env$ err exists
  exp file file$ filenum fkey freesp help$ hex$ inf int ip kln kps kstat$ len
  line lines linespp log login_name$ lpad$ lrec ltrm$ lwrc$ mat max max$ min
  min$ mod msgbox newpage not nxtcol nxtfld nxtrow or ord os_filename$ pi pos
  printer_list procin program$ rec rem rln rnd round rpad$ rpt$ rtrm$ serial
  session$ setenv sgn sin sleep sqr srch srep$ str$ sum tab tan time time$
  trim$ udim unhex$ uprc$ userid$ val version wbplatform$ wbversion$ wsid$
  xlate$`.split(/\s+/u),
);
