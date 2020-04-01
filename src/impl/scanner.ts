/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ScanError, SyntaxKind, JSONScanner } from '../main';

/**
 * Creates a JSON scanner on the given text.
 * If ignoreTrivia is set, whitespaces or comments are ignored.
 */
export function createScanner(text: string, ignoreTrivia: boolean = false): JSONScanner {

	const len = text.length;
	let pos = 0,
		value: string = '',
		tokenOffset = 0,
		token: SyntaxKind = SyntaxKind.Unknown,
		lineNumber = 0,
		lineStartOffset = 0,
		tokenLineStartOffset = 0,
		prevTokenLineStartOffset = 0,
		scanError: ScanError = ScanError.None;

	function scanHexDigits(count?: number): number | undefined {
		let digits = 0;
		let value = undefined;
		do {
			let ch = text.charCodeAt(pos);
			if (ch >= CharacterCodes._0 && ch <= CharacterCodes._9) {
				value = (value || 0) * 16 + ch - CharacterCodes._0;
			}
			else if (ch >= CharacterCodes.A && ch <= CharacterCodes.F) {
				value = (value || 0) * 16 + ch - CharacterCodes.A + 10;
			}
			else if (ch >= CharacterCodes.a && ch <= CharacterCodes.f) {
				value = (value || 0) * 16 + ch - CharacterCodes.a + 10;
			}
			else {
				break;
			}
			pos++;
			digits++;
		} while (value != undefined || (!count || digits >= count))
		return value;
	}

	function setPosition(newPosition: number) {
		pos = newPosition;
		value = '';
		tokenOffset = 0;
		token = SyntaxKind.Unknown;
		scanError = ScanError.None;
	}

	type ScanSuccess = {
		kind: 'success';
		lexeme: string;
	};
	type ScanFailure = {
		kind: 'failure';
		error: Error;
	};
	type ScanResult = ScanSuccess | ScanFailure;

	type Scanner = (input: string) => ScanResult;

	function isFailure(result: ScanResult): result is ScanFailure {
		return result.kind === 'failure' && result.error instanceof Error;
	}

	function literal(text: string): Scanner {
		const scanLiteral = (input: string) => {
			if (input.startsWith(text)) {
				return {
					kind: 'success',
					lexeme: text
				} as const;
			} else {
				return {
					kind: 'failure',
					error: new Error(`Unable to scan literal "${text}" from "${input}"`)
				} as const;
			}
		};
		Object.defineProperty(scanLiteral, 'name', {
			value: `literal("${text}")`
		});
		return scanLiteral;
	}

	function combineAnd(firstResult: ScanResult, secondResult: ScanResult): ScanResult {
		if (isFailure(firstResult)) {
			return firstResult;
		} else if (isFailure(secondResult)) {
			return secondResult;
		} else {
			return {
				kind: 'success',
				lexeme: firstResult.lexeme + secondResult.lexeme
			};
		}
	}

	/** This function is greedy; if both succeeded, return the longer result. */
	function combineOr(firstResult: ScanResult, secondResult: ScanResult): ScanResult {
		if (isFailure(secondResult)) {
			return firstResult;
		} else if (isFailure(firstResult)) {
			return secondResult;
		} else if (firstResult.lexeme.length > secondResult.lexeme.length) {
			return firstResult;
		} else {
			return secondResult;
		}
	}

	function and(firstScanner: Scanner, ...otherScanners: [Scanner, ...Scanner[]]): Scanner {
		const scanAnd = (input: string) => {
			let result = firstScanner(input);
			let remainingInput = input;
			for (const scanner of otherScanners) {
				if (isFailure(result)) {
					break;
				}
				remainingInput = input.substring(result.lexeme.length);
				result = combineAnd(result, scanner(remainingInput));
			}
			return result;
		};
		const scannerNames = [firstScanner, ...otherScanners].map(f => f.name);
		Object.defineProperty(scanAnd, 'name', {
			value: `and(${scannerNames.join(', ')})`
		});
		return scanAnd;
	}

	/** This function is greedy; if multiple scanners succeed, return the longest result. */
	function or(firstScanner: Scanner, ...otherScanners: [Scanner, ...Scanner[]]): Scanner {
		const scanOr = (input: string) => {
			let result = firstScanner(input);
			for (const scanner of otherScanners) {
				result = combineOr(result, scanner(input));
			}
			return result;
		};
		const scannerNames = [firstScanner, ...otherScanners].map(f => f.name);
		Object.defineProperty(scanOr, 'name', {
			value: `or(${scannerNames.join(', ')})`
		});
		return scanOr;
	}

	function zeroOrMore(scanner: Scanner): Scanner {
		const scanZeroOrMore = (input: string) => {
			let result = scanner(input);
			if (isFailure(result)) {
				return scanNothing(input);
			}
			let remainingInput: string;
			do {
				remainingInput = isFailure(result) ? '' : input.substring(result.lexeme.length);
				const nextResult = scanner(remainingInput);
				if (isFailure(nextResult)) {
					break;
				}
				result = combineAnd(result, nextResult);
			} while (remainingInput.length > 0);
			return result;
		};
		Object.defineProperty(scanZeroOrMore, 'name', {
			value: `zeroOrMore(${scanner.name})`
		});
		return scanZeroOrMore;
	}

	function oneOrMore(scanner: Scanner): Scanner {
		const scanOneOrMore = (input: string) => {
			const result = scanner(input);
			if (isFailure(result)) {
				return result;
			}
			const remainingInput = isFailure(result) ? '' : input.substring(result.lexeme.length);
			return combineAnd(result, zeroOrMore(scanner)(remainingInput))
		};
		Object.defineProperty(scanOneOrMore, 'name', {
			value: `oneOrMore(${scanner.name})`
		});
		return scanOneOrMore;
	}

	function optional(scanner: Scanner): Scanner {
		const scanOptional = (input: string) => {
			const result = or(scanner, scanNothing)(input);
			return result;
		};
		Object.defineProperty(scanOptional, 'name', {
			value: `optional(${scanner.name})`
		});
		return scanOptional;
	}

	function scanNothing(input: string): ScanResult {
		return {
			kind: 'success',
			lexeme: ''
		};
	}

	// HexDigit :: one of
	// 	0 1 2 3 4 5 6 7 8 9 a b c d e f A B C D E F
	function scanHexDigit(input: string): ScanResult {
		const ch = input.charCodeAt(0);
		if (
			(ch >= CharacterCodes._0 && ch <= CharacterCodes._9) ||
			(ch >= CharacterCodes.A && ch <= CharacterCodes.F) ||
			(ch >= CharacterCodes.a && ch <= CharacterCodes.f)
		) {
			return {
				kind: 'success',
				lexeme: String.fromCharCode(ch)
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan hex digit from "${input}"`)
			};
		}
	}

	// DecimalDigit :: one of
	// 	0 1 2 3 4 5 6 7 8 9
	function scanDecimalDigit(input: string): ScanResult {
		const ch = input.charCodeAt(0);
		if (ch >= CharacterCodes._0 && ch <= CharacterCodes._9) {
			return {
				kind: 'success',
				lexeme: String.fromCharCode(ch)
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan decimal digit from "${input}"`)
			};
		}
	}

	// NonZeroDigit :: one of
	// 	1 2 3 4 5 6 7 8 9
	function scanNonZeroDigit(input: string): ScanResult {
		const ch = input.charCodeAt(0);
		if (ch >= CharacterCodes._1 && ch <= CharacterCodes._9) {
			return {
				kind: 'success',
				lexeme: String.fromCharCode(ch)
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan non-zero digit from "${input}"`)
			};
		}
	}

	// ExponentIndicator :: one of
	// 	e E
	function scanExponentIndicator(input: string): ScanResult {
		const ch = input.charCodeAt(0);
		if (ch === CharacterCodes.e || ch === CharacterCodes.E) {
			return {
				kind: 'success',
				lexeme: String.fromCharCode(ch)
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan exponent indicator from "${input}"`)
			};
		}
	}

	// HexIntegerLiteral ::
	// 	0x HexDigit
	// 	0X HexDigit
	// 	HexIntegerLiteral HexDigit
	function scanHexIntegerLiteral(input: string): ScanResult {
		return or(and(literal('0x'), oneOrMore(scanHexDigit)), and(literal('0X'), oneOrMore(scanHexDigit)))(input);
	}

	// DecimalDigits ::
	// 	DecimalDigit
	// 	DecimalDigits DecimalDigit
	function scanDecimalDigits(input: string): ScanResult {
		return oneOrMore(scanDecimalDigit)(input);
	}

	// SignedInteger ::
	// 	DecimalDigits
	// 	+ DecimalDigits
	// 	- DecimalDigits
	function scanSignedInteger(input: string): ScanResult {
		return or(scanDecimalDigits, and(literal('+'), scanDecimalDigits), and(literal('-'), scanDecimalDigits))(input);
	}

	// ExponentPart ::
	// 	ExponentIndicator SignedInteger
	function scanExponentPart(input: string): ScanResult {
		return and(scanExponentIndicator, scanSignedInteger)(input);
	}

	// DecimalIntegerLiteral ::
	// 	0
	// 	NonZeroDigit DecimalDigits(opt)
	function scanDecimalIntegerLiteral(input: string): ScanResult {
		return or(literal('0'), and(scanNonZeroDigit, optional(scanDecimalDigits)))(input);
	}

	// DecimalLiteral ::
	// 	DecimalIntegerLiteral . DecimalDigits(opt) ExponentPart(opt)
	// 	. DecimalDigits ExponentPart(opt)
	// 	DecimalIntegerLiteral ExponentPart(opt)
	function scanDecimalLiteral(input: string): ScanResult {
		return or(
			and(scanDecimalIntegerLiteral, literal('.'), optional(scanDecimalDigits), optional(scanExponentPart)),
			and(literal('.'), scanDecimalDigits, optional(scanExponentPart)),
			and(scanDecimalIntegerLiteral, optional(scanExponentPart))
		)(input);
	}

	// NumericLiteral ::
	// 	DecimalLiteral
	// 	HexIntegerLiteral
	function scanNumericLiteral(input: string): ScanResult {
		return or(scanDecimalLiteral, scanHexIntegerLiteral)(input);
	}

	// JSON5NumericLiteral::
	// 	NumericLiteral
	// 	Infinity
	// 	NaN
	function scanJSON5NumericLiteral(input: string): ScanResult {
		return or(scanNumericLiteral, literal('Infinity'), literal('NaN'))(input);
	}

	// JSON5Number::
	// 	JSON5NumericLiteral
	// 	+ JSON5NumericLiteral
	// 	- JSON5NumericLiteral
	function scanJSON5Number(input: string): ScanResult {
		return or(scanJSON5NumericLiteral, and(literal('+'), scanJSON5NumericLiteral), and(literal('-'), scanJSON5NumericLiteral))(input);
	}

	function scanString(delimiter: CharacterCodes): string {

		let result = '',
			start = pos;

		while (true) {
			if (pos >= len) {
				result += text.substring(start, pos);
				scanError = ScanError.UnexpectedEndOfString;
				break;
			}
			const ch = text.charCodeAt(pos);
			if (ch === delimiter) {
				result += text.substring(start, pos);
				pos++;
				break;
			}
			if (ch === CharacterCodes.backslash) {
				result += text.substring(start, pos);
				pos++;
				if (pos >= len) {
					scanError = ScanError.UnexpectedEndOfString;
					break;
				}
				const ch2 = text.charCodeAt(pos++);
				switch (ch2) {
					case CharacterCodes.lineFeed:
					case CharacterCodes.lineSeparator:
					case CharacterCodes.paragraphSeparator:
						break;
					case CharacterCodes.carriageReturn:
						const ch3 = text.charCodeAt(pos++);
						if (ch3 === CharacterCodes.lineFeed) {
							pos++;
						}
						break;
					case CharacterCodes.doubleQuote:
						result += '\"';
						break;
					case CharacterCodes.singleQuote:
						result += '\'';
						break;
					case CharacterCodes.backslash:
						result += '\\';
						break;
					case CharacterCodes.slash:
						result += '/';
						break;
					case CharacterCodes.b:
						result += '\b';
						break;
					case CharacterCodes.f:
						result += '\f';
						break;
					case CharacterCodes.n:
						result += '\n';
						break;
					case CharacterCodes.r:
						result += '\r';
						break;
					case CharacterCodes.t:
						result += '\t';
						break;
					case CharacterCodes.v:
						result += '\v';
						break;
					case CharacterCodes._0:
						result += '\0';
						break;
					case CharacterCodes.u:
						const hex = scanHexDigits(4);
						if (hex !== undefined) {
							result += String.fromCharCode(hex);
						} else {
							scanError = ScanError.InvalidUnicode;
						}
						break;
					default:
						scanError = ScanError.InvalidEscapeCharacter;
				}
				start = pos;
				continue;
			}
			if (ch >= 0 && ch <= 0x1f) {
				if (isLineBreak(ch)) {
					result += text.substring(start, pos);
					scanError = ScanError.UnexpectedEndOfString;
					break;
				} else {
					scanError = ScanError.InvalidCharacter;
					// mark as error but continue with string
				}
			}
			pos++;
		}
		return result;
	}

	function scanNext(): SyntaxKind {

		value = '';
		scanError = ScanError.None;

		tokenOffset = pos;
		lineStartOffset = lineNumber;
		prevTokenLineStartOffset = tokenLineStartOffset;

		if (pos >= len) {
			// at the end
			tokenOffset = len;
			return token = SyntaxKind.EOF;
		}

		let code = text.charCodeAt(pos);
		// trivia: whitespace
		if (isWhiteSpace(code)) {
			do {
				pos++;
				value += String.fromCharCode(code);
				code = text.charCodeAt(pos);
			} while (isWhiteSpace(code));

			return token = SyntaxKind.Trivia;
		}

		// trivia: newlines
		if (isLineBreak(code)) {
			pos++;
			value += String.fromCharCode(code);
			if (code === CharacterCodes.carriageReturn && text.charCodeAt(pos) === CharacterCodes.lineFeed) {
				pos++;
				value += '\n';
			}
			lineNumber++;
			tokenLineStartOffset = pos;
			return token = SyntaxKind.LineBreakTrivia;
		}

		switch (code) {
			// tokens: []{}:,
			case CharacterCodes.openBrace:
				pos++;
				return token = SyntaxKind.OpenBraceToken;
			case CharacterCodes.closeBrace:
				pos++;
				return token = SyntaxKind.CloseBraceToken;
			case CharacterCodes.openBracket:
				pos++;
				return token = SyntaxKind.OpenBracketToken;
			case CharacterCodes.closeBracket:
				pos++;
				return token = SyntaxKind.CloseBracketToken;
			case CharacterCodes.colon:
				pos++;
				return token = SyntaxKind.ColonToken;
			case CharacterCodes.comma:
				pos++;
				return token = SyntaxKind.CommaToken;

			// strings
			case CharacterCodes.doubleQuote:
				pos++;
				value = scanString(CharacterCodes.doubleQuote);
				return token = SyntaxKind.StringLiteral;
			case CharacterCodes.singleQuote:
				pos++;
				value = scanString(CharacterCodes.singleQuote);
				return token = SyntaxKind.StringLiteral;

			// comments
			case CharacterCodes.slash:
				const start = pos - 1;
				// Single-line comment
				if (text.charCodeAt(pos + 1) === CharacterCodes.slash) {
					pos += 2;

					while (pos < len) {
						if (isLineBreak(text.charCodeAt(pos))) {
							break;
						}
						pos++;

					}
					value = text.substring(start, pos);
					return token = SyntaxKind.LineCommentTrivia;
				}

				// Multi-line comment
				if (text.charCodeAt(pos + 1) === CharacterCodes.asterisk) {
					pos += 2;

					const safeLength = len - 1; // For lookahead.
					let commentClosed = false;
					while (pos < safeLength) {
						const ch = text.charCodeAt(pos);

						if (ch === CharacterCodes.asterisk && text.charCodeAt(pos + 1) === CharacterCodes.slash) {
							pos += 2;
							commentClosed = true;
							break;
						}

						pos++;

						if (isLineBreak(ch)) {
							if (ch === CharacterCodes.carriageReturn && text.charCodeAt(pos) === CharacterCodes.lineFeed) {
								pos++;
							}

							lineNumber++;
							tokenLineStartOffset = pos;
						}
					}
					
					if (!commentClosed) {
						pos++;
						scanError = ScanError.UnexpectedEndOfComment;
					}

					value = text.substring(start, pos);
					return token = SyntaxKind.BlockCommentTrivia;
				}
				// just a single slash
				value += String.fromCharCode(code);
				pos++;
				return token = SyntaxKind.Unknown;

			// numbers
			case CharacterCodes.minus:
			case CharacterCodes.plus:
			case CharacterCodes.dot:
			case CharacterCodes._0:
			case CharacterCodes._1:
			case CharacterCodes._2:
			case CharacterCodes._3:
			case CharacterCodes._4:
			case CharacterCodes._5:
			case CharacterCodes._6:
			case CharacterCodes._7:
			case CharacterCodes._8:
			case CharacterCodes._9:
				const scanResult = scanJSON5Number(text.substring(pos));
				if (isFailure(scanResult)) {
					pos++;
					scanError = ScanError.None;
					return (token = SyntaxKind.Unknown);
				} else {
					scanError = ScanError.None;
					value = scanResult.lexeme;
					pos += scanResult.lexeme.length;
					return (token = SyntaxKind.NumericLiteral);
				}

			// literals and unknown symbols
			default:
				// is a literal? Read the full word.
				while (pos < len && isUnknownContentCharacter(code)) {
					pos++;
					code = text.charCodeAt(pos);
				}
				if (tokenOffset !== pos) {
					value = text.substring(tokenOffset, pos);
					// keywords: true, false, null
					switch (value) {
						case 'true':
							return (token = SyntaxKind.TrueKeyword);
						case 'false':
							return (token = SyntaxKind.FalseKeyword);
						case 'null':
							return (token = SyntaxKind.NullKeyword);
					}
					// or maybe it's one of the JSON5 literals
					// TODO: handle this more gracefully
					const scanResult = scanJSON5Number(value);
					if (!isFailure(scanResult)) {
						scanError = ScanError.None;
						return (token = SyntaxKind.NumericLiteral);
					}
					return (token = SyntaxKind.Unknown);
				}
				// some
				value += String.fromCharCode(code);
				pos++;
				return (token = SyntaxKind.Unknown);
		}
	}

	function isUnknownContentCharacter(code: CharacterCodes) {
		if (isWhiteSpace(code) || isLineBreak(code)) {
			return false;
		}
		switch (code) {
			case CharacterCodes.closeBrace:
			case CharacterCodes.closeBracket:
			case CharacterCodes.openBrace:
			case CharacterCodes.openBracket:
			case CharacterCodes.doubleQuote:
			case CharacterCodes.colon:
			case CharacterCodes.comma:
			case CharacterCodes.slash:
				return false;
		}
		return true;
	}


	function scanNextNonTrivia(): SyntaxKind {
		let result: SyntaxKind;
		do {
			result = scanNext();
		} while (result >= SyntaxKind.LineCommentTrivia && result <= SyntaxKind.Trivia);
		return result;
	}

	return {
		setPosition: setPosition,
		getPosition: () => pos,
		scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
		getToken: () => token,
		getTokenValue: () => value,
		getTokenOffset: () => tokenOffset,
		getTokenLength: () => pos - tokenOffset,
		getTokenStartLine: () => lineStartOffset,
		getTokenStartCharacter: () => tokenOffset - prevTokenLineStartOffset,
		getTokenError: () => scanError,
	};
}

function isWhiteSpace(ch: number): boolean {
	return ch === CharacterCodes.space || ch === CharacterCodes.tab || ch === CharacterCodes.verticalTab || ch === CharacterCodes.formFeed ||
		ch === CharacterCodes.nonBreakingSpace || ch === CharacterCodes.ogham || ch >= CharacterCodes.enQuad && ch <= CharacterCodes.zeroWidthSpace ||
		ch === CharacterCodes.narrowNoBreakSpace || ch === CharacterCodes.mathematicalSpace || ch === CharacterCodes.ideographicSpace || ch === CharacterCodes.byteOrderMark;
}

function isLineBreak(ch: number): boolean {
	return ch === CharacterCodes.lineFeed || ch === CharacterCodes.carriageReturn || ch === CharacterCodes.lineSeparator || ch === CharacterCodes.paragraphSeparator;
}

function isDigit(ch: number): boolean {
	return ch >= CharacterCodes._0 && ch <= CharacterCodes._9;
}

const enum CharacterCodes {
	nullCharacter = 0,
	maxAsciiCharacter = 0x7F,

	lineFeed = 0x0A,              // \n
	carriageReturn = 0x0D,        // \r
	lineSeparator = 0x2028,
	paragraphSeparator = 0x2029,

	// REVIEW: do we need to support this?  The scanner doesn't, but our IText does.  This seems
	// like an odd disparity?  (Or maybe it's completely fine for them to be different).
	nextLine = 0x0085,

	// Unicode 3.0 space characters
	space = 0x0020,   // " "
	nonBreakingSpace = 0x00A0,   //
	enQuad = 0x2000,
	emQuad = 0x2001,
	enSpace = 0x2002,
	emSpace = 0x2003,
	threePerEmSpace = 0x2004,
	fourPerEmSpace = 0x2005,
	sixPerEmSpace = 0x2006,
	figureSpace = 0x2007,
	punctuationSpace = 0x2008,
	thinSpace = 0x2009,
	hairSpace = 0x200A,
	zeroWidthSpace = 0x200B,
	narrowNoBreakSpace = 0x202F,
	ideographicSpace = 0x3000,
	mathematicalSpace = 0x205F,
	ogham = 0x1680,

	_ = 0x5F,
	$ = 0x24,

	_0 = 0x30,
	_1 = 0x31,
	_2 = 0x32,
	_3 = 0x33,
	_4 = 0x34,
	_5 = 0x35,
	_6 = 0x36,
	_7 = 0x37,
	_8 = 0x38,
	_9 = 0x39,

	a = 0x61,
	b = 0x62,
	c = 0x63,
	d = 0x64,
	e = 0x65,
	f = 0x66,
	g = 0x67,
	h = 0x68,
	i = 0x69,
	j = 0x6A,
	k = 0x6B,
	l = 0x6C,
	m = 0x6D,
	n = 0x6E,
	o = 0x6F,
	p = 0x70,
	q = 0x71,
	r = 0x72,
	s = 0x73,
	t = 0x74,
	u = 0x75,
	v = 0x76,
	w = 0x77,
	x = 0x78,
	y = 0x79,
	z = 0x7A,

	A = 0x41,
	B = 0x42,
	C = 0x43,
	D = 0x44,
	E = 0x45,
	F = 0x46,
	G = 0x47,
	H = 0x48,
	I = 0x49,
	J = 0x4A,
	K = 0x4B,
	L = 0x4C,
	M = 0x4D,
	N = 0x4E,
	O = 0x4F,
	P = 0x50,
	Q = 0x51,
	R = 0x52,
	S = 0x53,
	T = 0x54,
	U = 0x55,
	V = 0x56,
	W = 0x57,
	X = 0x58,
	Y = 0x59,
	Z = 0x5a,

	ampersand = 0x26,             // &
	asterisk = 0x2A,              // *
	at = 0x40,                    // @
	backslash = 0x5C,             // \
	bar = 0x7C,                   // |
	caret = 0x5E,                 // ^
	closeBrace = 0x7D,            // }
	closeBracket = 0x5D,          // ]
	closeParen = 0x29,            // )
	colon = 0x3A,                 // :
	comma = 0x2C,                 // ,
	dot = 0x2E,                   // .
	doubleQuote = 0x22,           // "
	equals = 0x3D,                // =
	exclamation = 0x21,           // !
	greaterThan = 0x3E,           // >
	lessThan = 0x3C,              // <
	minus = 0x2D,                 // -
	openBrace = 0x7B,             // {
	openBracket = 0x5B,           // [
	openParen = 0x28,             // (
	percent = 0x25,               // %
	plus = 0x2B,                  // +
	question = 0x3F,              // ?
	semicolon = 0x3B,             // ;
	singleQuote = 0x27,           // '
	slash = 0x2F,                 // /
	tilde = 0x7E,                 // ~

	backspace = 0x08,             // \b
	formFeed = 0x0C,              // \f
	byteOrderMark = 0xFEFF,
	tab = 0x09,                   // \t
	verticalTab = 0x0B,           // \v
}
