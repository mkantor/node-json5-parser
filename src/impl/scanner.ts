/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import JSON5 = require('json5');
import { ScanError, SyntaxKind, JSONScanner } from '../main';

/**
 * Creates a JSON scanner on the given text.
 * If ignoreTrivia is set, whitespaces or comments are ignored.
 */
export function createScanner(text: string, ignoreTrivia: boolean = false): JSONScanner {

	type ScanState = {
		token: SyntaxKind;
		value: string;
		scanError: ScanError;
		pos: number;
		lineNumber: number;
		tokenLineStartOffset: number;
	}

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

	function computeNextScanState(previousState: ScanState, scanResult: ScanResult, token: SyntaxKind): ScanState {
		const consumed = isFailure(scanResult) ? scanResult.consumed : scanResult.lexeme;
		const pos = previousState.pos + consumed.length;

		// Determine the position of the parsed token.
		let tokenLineStartOffset = previousState.tokenLineStartOffset;
		let lineNumber = previousState.lineNumber;
		let skip = 1;
		for (let index = 0; index < consumed.length; index += skip) {
			const lineBreak = scanLineTerminatorSequence(consumed.slice(index));
			if (isSuccess(lineBreak)) {
				skip = lineBreak.lexeme.length;
				lineNumber++;
				tokenLineStartOffset = previousState.pos + index + lineBreak.lexeme.length;
			} else {
				skip = 1;
			}
		}

		const intermediateState = {
			...previousState,
			token,
			pos,
			lineNumber,
			tokenLineStartOffset
		};

		if (token === SyntaxKind.StringLiteral) {
			return isFailure(scanResult)
				? {
						...intermediateState,
						scanError: ScanError.UnexpectedEndOfString
				  }
				: {
						...intermediateState,
						value: JSON5.parse(scanResult.lexeme)
				  };
		} else if (token === SyntaxKind.NumericLiteral) {
			return isFailure(scanResult)
				? {
						...intermediateState,
						token: SyntaxKind.Unknown
				  }
				: {
						...intermediateState,
						value: scanResult.lexeme
				  };
		} else if (token === SyntaxKind.LineCommentTrivia || token === SyntaxKind.BlockCommentTrivia) {
			return isFailure(scanResult)
				? {
						...intermediateState,
						scanError: ScanError.UnexpectedEndOfComment
				  }
				: {
						...intermediateState,
						value: scanResult.lexeme
				  };
		} else {
			// TODO
			throw new Error('Not all token types have been implemented yet!');
		}
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
		consumed: string;
	};
	type ScanResult = ScanSuccess | ScanFailure;

	type Scanner = (input: string) => ScanResult;

	function isSuccess(result: ScanResult): result is ScanSuccess {
		return result.kind === 'success' && typeof result.lexeme === 'string';
	}

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
					error: new Error(`Unable to scan literal "${text}" from "${input}"`),
					consumed: ''
				} as const;
			}
		};
		Object.defineProperty(scanLiteral, 'name', {
			value: `literal("${text}")`
		});
		return scanLiteral;
	}

	function match(pattern: RegExp): Scanner {
		const scanMatch = (input: string) => {
			const match = pattern.exec(input);
			if (match !== null && match.index === 0) {
				return {
					kind: 'success',
					lexeme: match[0]
				} as const;
			} else {
				return {
					kind: 'failure',
					error: new Error(`Unable to scan match ${pattern} from "${input}"`),
					consumed: ''
				} as const;
			}
		};
		Object.defineProperty(scanMatch, 'name', {
			value: `match(${pattern})`
		});
		return scanMatch;
	}

	function complete(scanner: Scanner): Scanner {
		return and(scanner, scanEmpty);
	}

	function combineAnd(firstResult: ScanResult, secondResult: ScanResult): ScanResult {
		if (isFailure(firstResult) && isFailure(secondResult)) {
			return {
				...firstResult,
				consumed: firstResult.consumed + secondResult.consumed
			};
		} else if (isFailure(firstResult)) {
			return firstResult;
		} else if (isFailure(secondResult)) {
			return {
				...secondResult,
				consumed: firstResult.lexeme + secondResult.consumed
			};
		} else {
			return {
				kind: 'success',
				lexeme: firstResult.lexeme + secondResult.lexeme
			};
		}
	}

	/** This function is greedy; if both succeeded, return the longer result. */
	function combineOr(firstResult: ScanResult, secondResult: ScanResult): ScanResult {
		if (isFailure(firstResult) && isFailure(secondResult)) {
			if (firstResult.consumed >= secondResult.consumed) {
				return firstResult;
			} else {
				return secondResult;
			}
		} else if (isFailure(secondResult)) {
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

	function butNot(scanner: Scanner, not: Scanner): Scanner {
		const scanButNot = (input: string) => {
			const result = scanner(input);
			if (isSuccess(result)) {
				if (isSuccess(not(input))) {
					return {
						kind: 'failure',
						error: new Error(`Matched ${scanner.name} but also matched ${not.name} with "${input}"`),
						consumed: result.lexeme
					} as const
				}
			}
			return result;
		};
		Object.defineProperty(scanButNot, 'name', {
			value: `butNot(${scanner.name}, ${not.name})`
		});
		return scanButNot;
	}

	function lookaheadNot(scanner: Scanner, notFollowedBy: Scanner): Scanner {
		const scanLookaheadNot = (input: string) => {
			const result = scanner(input);
			if (isSuccess(result)) {
				const remainingInput = input.substring(result.lexeme.length);
				if (isSuccess(notFollowedBy(remainingInput))) {
					return {
						kind: 'failure',
						error: new Error(`Lookahead detected invalid input "${input}"`),
						consumed: result.lexeme
					} as const
				}
			}
			return result;
		};
		Object.defineProperty(scanLookaheadNot, 'name', {
			value: `lookaheadNot(${scanner.name}, ${notFollowedBy.name})`
		});
		return scanLookaheadNot;
	}

	function scanNothing(input: string): ScanResult {
		return {
			kind: 'success',
			lexeme: ''
		};
	}

	function scanEmpty(input: string): ScanResult {
		if (input.length === 0) {
			return {
				kind: 'success',
				lexeme: ''
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Input "${input}" was not empty`),
				consumed: ''
			};
		}
	}

	// HexDigit :: one of
	// 	0 1 2 3 4 5 6 7 8 9 a b c d e f A B C D E F
	function scanHexDigit(input: string): ScanResult {
		return match(/^[0-9a-fA-F]/)(input);
	}

	// DecimalDigit :: one of
	// 	0 1 2 3 4 5 6 7 8 9
	function scanDecimalDigit(input: string): ScanResult {
		return match(/^[0-9]/)(input);
	}

	// NonZeroDigit :: one of
	// 	1 2 3 4 5 6 7 8 9
	function scanNonZeroDigit(input: string): ScanResult {
		return match(/^[1-9]/)(input);
	}

	// ExponentIndicator :: one of
	// 	e E
	function scanExponentIndicator(input: string): ScanResult {
		return or(literal('e'), literal('E'))(input);
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

	// LineTerminator ::
	// 	<LF>
	// 	<CR>
	// 	<LS>
	// 	<PS>
	function scanLineTerminator(input: string): ScanResult {
		return or(literal('\n'), literal('\r'), literal('\u2028'), literal('\u2029'))(input);
	}

	// LineTerminatorSequence ::
	// 	<LF>
	// 	<CR> [lookahead ∉ <LF> ]
	// 	<LS>
	// 	<PS>
	// 	<CR> <LF>
	function scanLineTerminatorSequence(input: string): ScanResult {
		return or(
			literal('\n'),
			lookaheadNot(literal('\r'), literal('\n')),
			literal('\u2028'),
			literal('\r\n')
		)(input);
	}

	// LineContinuation ::
	// 	\ LineTerminatorSequence
	function scanLineContinuation(input: string): ScanResult {
		return and(literal('\\'), scanLineTerminatorSequence)(input);
	}

	// HexEscapeSequence ::
	// 	x HexDigit HexDigit
	function scanHexEscapeSequence(input: string): ScanResult {
		return and(literal('x'), scanHexDigit, scanHexDigit)(input);
	}

	// UnicodeEscapeSequence ::
	// 	u HexDigit HexDigit HexDigit HexDigit
	function scanUnicodeEscapeSequence(input: string): ScanResult {
		return and(literal('u'), scanHexDigit, scanHexDigit, scanHexDigit, scanHexDigit)(input);
	}

	// EscapeCharacter ::
	// 	SingleEscapeCharacter
	// 	DecimalDigit
	// 	x
	// 	u
	function scanEscapeCharacter(input: string): ScanResult {
		return or(
			scanSingleEscapeCharacter,
			scanDecimalDigit,
			literal('x'),
			literal('u')
		)(input);
	}

	// SingleEscapeCharacter :: one of
	// 	' " \ b f n r t v
	function scanSingleEscapeCharacter(input: string): ScanResult {
		return or(
			literal("'"),
			literal('"'),
			literal('\\'),
			literal('b'),
			literal('f'),
			literal('n'),
			literal('r'),
			literal('t'),
			literal('v')
		)(input);
	}

	// SourceCharacter ::
	// 	any Unicode code unit
	function scanSourceCharacter(input: string): ScanResult {
		const codePoint = input.codePointAt(0);
		if (codePoint !== undefined) {
			return {
				kind: 'success',
				lexeme: String.fromCodePoint(codePoint)
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan source character from "${input}"`),
				consumed: ''
			};
		}
	}

	// NonEscapeCharacter ::
	// 	SourceCharacter but not one of EscapeCharacter or LineTerminator
	function scanNonEscapeCharacter(input: string): ScanResult {
		const result = scanSourceCharacter(input);
		if (isSuccess(result)) {
			if (isSuccess(scanEscapeCharacter(input))) {
				return {
					kind: 'failure',
					error: new Error(`Scanned escape character when trying to scan non-escape character from "${input}"`),
					consumed: ''
				};
			} else if (isSuccess(scanLineTerminator(input))) {
				return {
					kind: 'failure',
					error: new Error(`Scanned line terminator when trying to scan non-escape character from "${input}"`),
					consumed: ''
				};
			}
		}
		return result;
	}

	// CharacterEscapeSequence ::
	// 	SingleEscapeCharacter
	// 	NonEscapeCharacter
	function scanCharacterEscapeSequence(input: string): ScanResult {
		return or(scanSingleEscapeCharacter, scanNonEscapeCharacter)(input);
	}

	// EscapeSequence ::
	// 	CharacterEscapeSequence
	// 	0 [lookahead ∉ DecimalDigit]
	// 	HexEscapeSequence
	// 	UnicodeEscapeSequence
	function scanEscapeSequence(input: string): ScanResult {
		return or(
			scanCharacterEscapeSequence,
			lookaheadNot(literal('0'), scanDecimalDigit),
			scanHexEscapeSequence,
			scanUnicodeEscapeSequence
		)(input);
	}

	// JSON5SingleStringCharacter::
	// 	SourceCharacter but not one of ' or \ or LineTerminator
	// 	\ EscapeSequence
	// 	LineContinuation
	// 	U+2028
	// 	U+2029
	function scanJSON5SingleStringCharacter(input: string): ScanResult {
		return or(
			butNot(scanSourceCharacter, or(literal("'"), literal('\\'), scanLineTerminator)),
			and(literal('\\'), scanEscapeSequence),
			scanLineContinuation,
			literal('\u2028'),
			literal('\u2029')
		)(input);
	}

	// JSON5DoubleStringCharacter::
	// 	SourceCharacter but not one of " or \ or LineTerminator
	// 	\ EscapeSequence
	// 	LineContinuation
	// 	U+2028
	// 	U+2029
	function scanJSON5DoubleStringCharacter(input: string): ScanResult {
		return or(
			butNot(scanSourceCharacter, or(literal('"'), literal('\\'), scanLineTerminator)),
			and(literal('\\'), scanEscapeSequence),
			scanLineContinuation,
			literal('\u2028'),
			literal('\u2029')
		)(input);
	}

	// JSON5SingleStringCharacters::
	// 	JSON5SingleStringCharacter JSON5SingleStringCharacters(opt)
	function scanJSON5SingleStringCharacters(input: string): ScanResult {
		return oneOrMore(scanJSON5SingleStringCharacter)(input);
	}

	// JSON5DoubleStringCharacters::
	// 	JSON5DoubleStringCharacter JSON5DoubleStringCharacters(opt)
	function scanJSON5DoubleStringCharacters(input: string): ScanResult {
		return oneOrMore(scanJSON5DoubleStringCharacter)(input);
	}

	// JSON5String::
	// 	"JSON5DoubleStringCharacters(opt)"
	// 	'JSON5SingleStringCharacters(opt)'
	function scanJSON5String(input: string): ScanResult {
		return or(
			and(literal('"'), zeroOrMore(scanJSON5DoubleStringCharacters), literal('"')),
			and(literal("'"), zeroOrMore(scanJSON5SingleStringCharacters), literal("'"))
		)(input);
	}

	// BooleanLiteral ::
	// 	true
	// 	false
	function scanBooleanLiteral(input: string): ScanResult {
		return or(literal('true'), literal('false'))(input);
	}

	// JSON5Boolean ::
	// 	BooleanLiteral
	function scanJSON5Boolean(input: string): ScanResult {
		return scanBooleanLiteral(input);
	}

	// NullLiteral ::
	// 	null
	function scanNullLiteral(input: string): ScanResult {
		return literal('null')(input);
	}

	// JSON5Null ::
	//	NullLiteral
	function scanJSON5Null(input: string): ScanResult {
		return scanNullLiteral(input);
	}

	// JSON5Punctuator :: one of
	//	{ } [ ] : ,
	function scanJSON5Punctuator(input: string): ScanResult {
		return or(
			literal('{'),
			literal('}'),
			literal('['),
			literal(']'),
			literal(':'),
			literal(',')
		)(input);
	}

	// UnicodeConnectorPunctuation ::
	// 	any character in the Unicode category "Connector punctuation (Pc)"
	function scanUnicodeConnectorPunctuation(input: string): ScanResult {
		return match(/^\p{Pc}/u)(input);
	}

	// UnicodeDigit ::
	// 	any character in the Unicode category "Decimal number (Nd)"
	function scanUnicodeDigit(input: string): ScanResult {
		return match(/^\p{Nd}/u)(input);
	}

	// UnicodeCombiningMark ::
	// 	any character in the Unicode categories "Non-spacing mark (Mn)" or "Combining spacing mark (Mc)"
	function scanUnicodeCombiningMark(input: string): ScanResult {
		return match(/^\p{Mn}|^\p{Mc}/u)(input);
	}

	// UnicodeLetter ::
	// 	any character in the Unicode categories "Uppercase letter (Lu)", "Lowercase letter (Ll)", "Titlecase letter (Lt)", "Modifier letter (Lm)", "Other letter (Lo)", or "Letter number (Nl)".
	function scanUnicodeLetter(input: string): ScanResult {
		return match(/^\p{Lu}|^\p{Ll}|^\p{Lt}|^\p{Lm}|^\p{Lo}|^\p{Nl}/u)(input);
	}

	// IdentifierStart ::
	// 	UnicodeLetter
	// 	$
	// 	_
	// 	\ UnicodeEscapeSequence
	function scanIdentifierStart(input: string): ScanResult {
		return or(
			scanUnicodeLetter,
			literal('$'),
			literal('_'),
			and(literal('\\'), scanUnicodeEscapeSequence)
		)(input);
	}

	// IdentifierPart ::
	// 	IdentifierStart
	// 	UnicodeCombiningMark
	// 	UnicodeDigit
	// 	UnicodeConnectorPunctuation
	// 	<ZWNJ>
	// 	<ZWJ>
	function scanIdentifierPart(input: string): ScanResult {
		return or(
			scanIdentifierStart,
			scanUnicodeCombiningMark,
			scanUnicodeDigit,
			scanUnicodeConnectorPunctuation,
			literal('\u200C'),
			literal('\u200D')
		)(input);
	}

	// IdentifierName ::
	// 	IdentifierStart
	// 	IdentifierName IdentifierPart
	function scanIdentifierName(input: string): ScanResult {
		return or(scanIdentifierStart, and(scanIdentifierName, scanIdentifierPart))(input);
	}

	// JSON5Identifier ::
	//	IdentifierName
	function scanJSON5Identifier(input: string): ScanResult {
		return scanIdentifierName(input);
	}

	// JSON5Token ::
	// 	JSON5Identifier
	// 	JSON5Punctuator
	// 	JSON5String
	// 	JSON5Number
	function scanJSON5Token(input: string): ScanResult {
		return or(scanJSON5Identifier, scanJSON5Punctuator, scanJSON5String, scanJSON5Number)(input);
	}

	// SingleLineCommentChar ::
	// 	SourceCharacter but not LineTerminator
	function scanSingleLineCommentChar(input: string): ScanResult {
		return butNot(scanSourceCharacter, scanLineTerminator)(input);
	}

	// SingleLineCommentChars ::
	// 	SingleLineCommentChar SingleLineCommentChars(opt)
	function scanSingleLineCommentChars(input: string): ScanResult {
		return and(scanSingleLineCommentChar, optional(scanSingleLineCommentChars))(input);
	}

	// SingleLineComment ::
	// 	// SingleLineCommentChars(opt)
	function scanSingleLineComment(input: string): ScanResult {
		return and(literal('//'), optional(scanSingleLineCommentChars))(input);
	}

	// MultiLineNotForwardSlashOrAsteriskChar ::
	// 	SourceCharacter but not one of / or *
	function scanMultiLineNotForwardSlashOrAsteriskChar(input: string): ScanResult {
		return butNot(scanSourceCharacter, or(literal('/'), literal('*')))(input);
	}

	// MultiLineNotAsteriskChar ::
	// 	SourceCharacter but not *
	function scanMultiLineNotAsteriskChar(input: string): ScanResult {
		return butNot(scanSourceCharacter, literal('*'))(input);
	}

	// PostAsteriskCommentChars ::
	// 	MultiLineNotForwardSlashOrAsteriskChar MultiLineCommentChars(opt)
	// 	* PostAsteriskCommentChars(opt)
	function scanPostAsteriskCommentChars(input: string): ScanResult {
		return or(
			and(scanMultiLineNotForwardSlashOrAsteriskChar, optional(scanMultiLineCommentChars)),
			and(literal('*'), optional(scanPostAsteriskCommentChars))
		)(input);
	}

	// MultiLineCommentChars ::
	// 	MultiLineNotAsteriskChar MultiLineCommentChars(opt)
	// 	* PostAsteriskCommentChars(opt)
	function scanMultiLineCommentChars(input: string): ScanResult {
		// Note: this doesn't exactly follow the grammar because the final '*' from
		// '*/' should not be part of the lexeme.
		return oneOrMore(or(scanMultiLineNotAsteriskChar, lookaheadNot(literal('*'), literal('/'))))(
			input
		);
	}

	// MultiLineComment ::
	// 	/* MultiLineCommentChars(opt) */
	function scanMultiLineComment(input: string): ScanResult {
		return and(literal('/*'), optional(scanMultiLineCommentChars), literal('*/'))(input);
	}

	// Comment ::
	// 	MultiLineComment
	// 	SingleLineComment
	function scanComment(input: string): ScanResult {
		return or(scanMultiLineComment, scanSingleLineComment)(input);
	}

	// WhiteSpace ::
	// 	<TAB>
	// 	<VT>
	// 	<FF>
	// 	<SP>
	// 	<NBSP>
	// 	<BOM>
	// 	<USP>
	function scanWhiteSpace(input: string): ScanResult {
		return or(
			literal('\t'),
			literal('\u000B'),
			literal('\u000C'),
			literal('\u0020'),
			literal('\u00A0'),
			literal('\uFEFF'),
			match(/^\p{Zs}/u)
		)(input);
	}

	// JSON5InputElement ::
	// 	WhiteSpace
	// 	LineTerminator
	// 	Comment
	// 	JSON5Token
	function scanJSON5InputElement(input: string): ScanResult {
		return or(scanWhiteSpace, scanLineTerminator, scanComment, scanJSON5Token)(input);
	}

	function scanNext(): SyntaxKind {

		value = '';
		scanError = ScanError.None;

		tokenOffset = pos;
		lineStartOffset = lineNumber;
		prevTokenLineStartOffset = tokenLineStartOffset;

		const updateState = (state: ScanState): void => {
			token = state.token;
			value = state.value;
			scanError = state.scanError;
			pos = state.pos;
			lineNumber = state.lineNumber;
			tokenLineStartOffset = state.tokenLineStartOffset;
		};

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

		const currentState: ScanState = {
			token,
			value,
			scanError,
			pos,
			lineNumber,
			tokenLineStartOffset
		};
		let nextState: ScanState;
		let scanResult: ScanResult;
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
			case CharacterCodes.singleQuote:
				scanResult = scanJSON5String(text.substring(pos));
				nextState = computeNextScanState(currentState, scanResult, SyntaxKind.StringLiteral);
				updateState(nextState);
				return token;

			// comments
			case CharacterCodes.slash:
				// Single-line comment
				if (text.charCodeAt(pos + 1) === CharacterCodes.slash) {
					scanResult = scanSingleLineComment(text.substring(pos));
					nextState = computeNextScanState(currentState, scanResult, SyntaxKind.LineCommentTrivia);
					updateState(nextState);
					return token;
				}

				// Multi-line comment
				if (text.charCodeAt(pos + 1) === CharacterCodes.asterisk) {
					scanResult = scanMultiLineComment(text.substring(pos));
					nextState = computeNextScanState(currentState, scanResult, SyntaxKind.BlockCommentTrivia);
					updateState(nextState);
					return token;
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
				scanResult = scanJSON5Number(text.substring(pos));
				nextState = computeNextScanState(currentState, scanResult, SyntaxKind.NumericLiteral);
				updateState(nextState);
				return token;

			// literals and unknown symbols
			default:
				// is a literal? Read the full word.
				while (pos < len && isUnknownContentCharacter(code)) {
					pos++;
					code = text.charCodeAt(pos);
				}
				if (tokenOffset !== pos) {
					value = text.substring(tokenOffset, pos);
					if (isSuccess(complete(literal('true'))(value))) {
						return (token = SyntaxKind.TrueKeyword);
					} else if (isSuccess(complete(literal('false'))(value))) {
						return (token = SyntaxKind.FalseKeyword);
					} else if (isSuccess(complete(literal('null'))(value))) {
						return (token = SyntaxKind.NullKeyword);
					} else if (isSuccess(complete(scanJSON5Number)(value))) {
						return (token = SyntaxKind.NumericLiteral);
					} else {
						return (token = SyntaxKind.Unknown);
					}
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
