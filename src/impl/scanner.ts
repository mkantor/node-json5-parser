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

	function computeNextScanState(previousState: ScanState, scanResult: ScanResult): ScanState {
		type ErrorAttributesMap = { [key in SyntaxKind]: Partial<ScanState> }
		const errorAttributesMap: ErrorAttributesMap = {
			[SyntaxKind.OpenBraceToken]: {},
			[SyntaxKind.CloseBraceToken]: {},
			[SyntaxKind.OpenBracketToken]: {},
			[SyntaxKind.CloseBracketToken]: {},
			[SyntaxKind.ColonToken]: {},
			[SyntaxKind.CommaToken]: {},
			[SyntaxKind.StringLiteral]: { scanError: ScanError.UnexpectedEndOfString },
			[SyntaxKind.NumericLiteral]: { token: SyntaxKind.Unknown },
			[SyntaxKind.LineCommentTrivia]: { scanError: ScanError.UnexpectedEndOfComment },
			[SyntaxKind.BlockCommentTrivia]: { scanError: ScanError.UnexpectedEndOfComment },
			[SyntaxKind.TrueKeyword]: { token: SyntaxKind.Unknown },
			[SyntaxKind.FalseKeyword]: { token: SyntaxKind.Unknown },
			[SyntaxKind.NullKeyword]: { token: SyntaxKind.Unknown },
			[SyntaxKind.LineBreakTrivia]: { token: SyntaxKind.Unknown },
			[SyntaxKind.Trivia]: { token: SyntaxKind.Unknown },
			[SyntaxKind.Unknown]: {},
			[SyntaxKind.EOF]: {},
			[SyntaxKind.Identifier]: {},
			[SyntaxKind.InfinityKeyword]: {},
			[SyntaxKind.NaNKeyword]: {}
		};
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

		const baseState = {
			...previousState,
			token: scanResult.syntaxKind,
			pos,
			lineNumber,
			tokenLineStartOffset
		};
		return isFailure(scanResult)
			? {
					...baseState,
					...errorAttributesMap[scanResult.syntaxKind]
			  }
			: {
					...baseState,
					// String literals have values parsed for legacy reasons.
					value:
						scanResult.syntaxKind === SyntaxKind.StringLiteral
							? JSON5.parse(scanResult.lexeme)
							: scanResult.lexeme
			  };
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
		syntaxKind: SyntaxKind;
	};
	type ScanFailure = {
		kind: 'failure';
		error: Error;
		consumed: string;
		syntaxKind: SyntaxKind;
	};
	type ScanResult = ScanSuccess | ScanFailure;

	type Scanner = (input: string) => ScanResult;

	function isSuccess(result: ScanResult): result is ScanSuccess {
		return (
			result.kind === 'success' &&
			typeof result.lexeme === 'string' &&
			typeof result.syntaxKind === 'number'
		);
	}

	function isFailure(result: ScanResult): result is ScanFailure {
		return (
			result.kind === 'failure' &&
			result.error instanceof Error &&
			typeof result.consumed === 'string' &&
			typeof result.syntaxKind === 'number'
		);
	}

	function withSyntaxKind(syntaxKind: SyntaxKind, scanner: Scanner): Scanner {
		const scanWithSyntaxKind = (input: string) => {
			return { ...scanner(input), syntaxKind };
		};
		Object.defineProperty(scanWithSyntaxKind, 'name', {
			value: `withSyntaxKind(${syntaxKind}, ${scanner.name})`
		});
		return scanWithSyntaxKind;
	}

	function literal(text: string): Scanner {
		const scanLiteral = (input: string) => {
			if (input.startsWith(text)) {
				return {
					kind: 'success',
					lexeme: text,
					syntaxKind: SyntaxKind.Unknown
				} as const;
			} else {
				return {
					kind: 'failure',
					error: new Error(`Unable to scan literal "${text}" from "${input}"`),
					consumed: '',
					syntaxKind: SyntaxKind.Unknown
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
					lexeme: match[0],
					syntaxKind: SyntaxKind.Unknown
				} as const;
			} else {
				return {
					kind: 'failure',
					error: new Error(`Unable to scan match ${pattern} from "${input}"`),
					consumed: '',
					syntaxKind: SyntaxKind.Unknown
				} as const;
			}
		};
		Object.defineProperty(scanMatch, 'name', {
			value: `match(${pattern})`
		});
		return scanMatch;
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
				lexeme: firstResult.lexeme + secondResult.lexeme,
				syntaxKind:
					secondResult.lexeme === ''
						? firstResult.syntaxKind
						: firstResult.lexeme === ''
						? secondResult.syntaxKind
						: firstResult.syntaxKind === secondResult.syntaxKind
						? firstResult.syntaxKind
						: SyntaxKind.Unknown
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
						consumed: result.lexeme,
						syntaxKind: SyntaxKind.Unknown
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
						consumed: result.lexeme,
						syntaxKind: SyntaxKind.Unknown
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
			lexeme: '',
			syntaxKind: SyntaxKind.Unknown
		};
	}

	function scanEmpty(input: string): ScanResult {
		if (input.length === 0) {
			return scanNothing(input);
		} else {
			return {
				kind: 'failure',
				error: new Error(`Input "${input}" was not empty`),
				consumed: '',
				syntaxKind: SyntaxKind.Unknown
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
		return withSyntaxKind(SyntaxKind.NumericLiteral, or(scanDecimalLiteral, scanHexIntegerLiteral))(input);
	}

	// Infinity
	function scanInfinityLiteral(input: string): ScanResult {
		return withSyntaxKind(SyntaxKind.InfinityKeyword, literal('Infinity'))(input);
	}

	// NaN
	function scanNaNLiteral(input: string): ScanResult {
		return withSyntaxKind(SyntaxKind.NaNKeyword, literal('NaN'))(input);
	}

	// JSON5NumericLiteral::
	// 	NumericLiteral
	// 	Infinity
	// 	NaN
	function scanJSON5NumericLiteral(input: string): ScanResult {
		return or(scanNumericLiteral, scanInfinityLiteral, scanNaNLiteral)(input);
	}

	// JSON5Number::
	// 	JSON5NumericLiteral
	// 	+ JSON5NumericLiteral
	// 	- JSON5NumericLiteral
	function scanJSON5Number(input: string): ScanResult {
		return or(
			scanJSON5NumericLiteral,
			withSyntaxKind(SyntaxKind.NumericLiteral, and(literal('+'), scanJSON5NumericLiteral)),
			withSyntaxKind(SyntaxKind.NumericLiteral, and(literal('-'), scanJSON5NumericLiteral))
		)(input);
	}

	// LineTerminator ::
	// 	<LF>
	// 	<CR>
	// 	<LS>
	// 	<PS>
	function scanLineTerminator(input: string): ScanResult {
		return withSyntaxKind(
			SyntaxKind.LineBreakTrivia,
			or(literal('\n'), literal('\r'), literal('\u2028'), literal('\u2029'))
		)(input);
	}

	// LineTerminatorSequence ::
	// 	<LF>
	// 	<CR> [lookahead ∉ <LF> ]
	// 	<LS>
	// 	<PS>
	// 	<CR> <LF>
	function scanLineTerminatorSequence(input: string): ScanResult {
		return withSyntaxKind(
			SyntaxKind.LineBreakTrivia,
			or(
				literal('\n'),
				lookaheadNot(literal('\r'), literal('\n')),
				literal('\u2028'),
				literal('\u2029'),
				literal('\r\n')
			)
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
				lexeme: String.fromCodePoint(codePoint),
				syntaxKind: SyntaxKind.Unknown
			};
		} else {
			return {
				kind: 'failure',
				error: new Error(`Unable to scan source character from "${input}"`),
				consumed: '',
				syntaxKind: SyntaxKind.Unknown
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
					consumed: '',
					syntaxKind: SyntaxKind.Unknown
				};
			} else if (isSuccess(scanLineTerminator(input))) {
				return {
					kind: 'failure',
					error: new Error(`Scanned line terminator when trying to scan non-escape character from "${input}"`),
					consumed: '',
					syntaxKind: SyntaxKind.Unknown
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
		return withSyntaxKind(
			SyntaxKind.StringLiteral,
			or(
				and(literal('"'), zeroOrMore(scanJSON5DoubleStringCharacters), literal('"')),
				and(literal("'"), zeroOrMore(scanJSON5SingleStringCharacters), literal("'"))
			)
		)(input);
	}

	// true
	function scanTrueLiteral(input: string): ScanResult {
		return withSyntaxKind(SyntaxKind.TrueKeyword, literal('true'))(input);
	}

	// false
	function scanFalseLiteral(input: string): ScanResult {
		return withSyntaxKind(SyntaxKind.FalseKeyword, literal('false'))(input);
	}

	// BooleanLiteral ::
	// 	true
	// 	false
	function scanBooleanLiteral(input: string): ScanResult {
		return or(scanTrueLiteral, scanFalseLiteral)(input);
	}

	// JSON5Boolean ::
	// 	BooleanLiteral
	function scanJSON5Boolean(input: string): ScanResult {
		return scanBooleanLiteral(input);
	}

	// NullLiteral ::
	// 	null
	function scanNullLiteral(input: string): ScanResult {
		return withSyntaxKind(SyntaxKind.NullKeyword, literal('null'))(input);
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
			withSyntaxKind(SyntaxKind.OpenBraceToken, literal('{')),
			withSyntaxKind(SyntaxKind.CloseBraceToken, literal('}')),
			withSyntaxKind(SyntaxKind.OpenBracketToken, literal('[')),
			withSyntaxKind(SyntaxKind.CloseBracketToken, literal(']')),
			withSyntaxKind(SyntaxKind.ColonToken, literal(':')),
			withSyntaxKind(SyntaxKind.CommaToken, literal(','))
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
		// Note: this doesn't exactly follow the grammar to avoid recursion.
		return or(
			scanIdentifierStart,
			and(scanIdentifierStart, oneOrMore(scanIdentifierPart))
		)(input);
	}

	// JSON5Identifier ::
	//	IdentifierName
	function scanJSON5Identifier(input: string): ScanResult {
		// Note: this doesn't exactly follow the grammar to get specific kinds for
		// keywords.
		return or(
			withSyntaxKind(SyntaxKind.Identifier, scanIdentifierName),
			scanNullLiteral,
			scanTrueLiteral,
			scanFalseLiteral,
			scanInfinityLiteral,
			scanNaNLiteral
		)(input);
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
		return withSyntaxKind(
			SyntaxKind.LineCommentTrivia,
			and(literal('//'), optional(scanSingleLineCommentChars))
		)(input);
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
		return withSyntaxKind(
			SyntaxKind.BlockCommentTrivia,
			and(literal('/*'), optional(scanMultiLineCommentChars), literal('*/'))
		)(input);
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
		// Note: this doesn't exactly follow the grammar because we want to treat
		// contiguous whitespace as one token.
		return withSyntaxKind(
			SyntaxKind.Trivia,
			oneOrMore(
				or(
					literal('\t'),
					literal('\u000B'),
					literal('\u000C'),
					literal('\u0020'),
					literal('\u00A0'),
					literal('\uFEFF'),
					match(/^\p{Zs}/u)
				)
			)
		)(input);
	}

	// JSON5InputElement ::
	// 	WhiteSpace
	// 	LineTerminator
	// 	Comment
	// 	JSON5Token
	function scanJSON5InputElement(input: string): ScanResult {
		// Note: this doesn't exactly follow the grammar because we want to treat
		// \r\n as a single token.
		return or(scanWhiteSpace, scanLineTerminatorSequence, scanComment, scanJSON5Token)(input);
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

		const currentState: ScanState = {
			token,
			value,
			scanError,
			pos,
			lineNumber,
			tokenLineStartOffset
		};
		const scanResult = scanJSON5InputElement(text.substring(pos));
		const nextState = computeNextScanState(currentState, scanResult);
		updateState(nextState);
		if (isFailure(scanResult)) {
			value += text[pos];
			pos++;
		}
		return token;
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
