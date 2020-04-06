import { SyntaxKind } from '../main';

export type ScanSuccess = {
	success: true;
	length: number;
	syntaxKind: SyntaxKind;
};
export type ScanFailure = {
	success: false;
	length: number;
	syntaxKind: SyntaxKind;
};
export type ScanResult = ScanSuccess | ScanFailure;

export type Scanner = (input: string) => ScanResult;

export function isSuccess(result: ScanResult): result is ScanSuccess {
	return (
		result.success &&
		typeof result.length === 'number' &&
		typeof result.syntaxKind === 'number'
	);
}

export function isFailure(result: ScanResult): result is ScanFailure {
	return (
		!result.success &&
		typeof result.length === 'number' &&
		typeof result.syntaxKind === 'number'
	);
}

function concatenate(
	firstResult: ScanSuccess,
	secondResult: ScanSuccess
): ScanSuccess {
	return {
		success: true,
		length: firstResult.length + secondResult.length,
		syntaxKind:
			secondResult.length === 0
				? firstResult.syntaxKind
				: firstResult.length === 0
				? secondResult.syntaxKind
				: SyntaxKind.Unknown
	};
}

function withSyntaxKind(syntaxKind: SyntaxKind, scanner: Scanner): Scanner {
	return input => {
		return { ...scanner(input), syntaxKind };
	};
}

function literal(text: string): Scanner {
	return input => {
		if (input.startsWith(text)) {
			return {
				success: true,
				length: text.length,
				syntaxKind: SyntaxKind.Unknown
			} as const;
		} else {
			return {
				success: false,
				length: 0,
				syntaxKind: SyntaxKind.Unknown
			} as const;
		}
	};
}

function match(pattern: RegExp): Scanner {
	return input => {
		const match = pattern.exec(input);
		if (match !== null && match.index === 0) {
			return {
				success: true,
				length: match[0].length,
				syntaxKind: SyntaxKind.Unknown
			} as const;
		} else {
			return {
				success: false,
				length: 0,
				syntaxKind: SyntaxKind.Unknown
			} as const;
		}
	};
}

function combineAnd(first: Scanner, second: Scanner): Scanner {
	return input => {
		const firstResult = first(input);
		if (isFailure(firstResult)) {
			return firstResult;
		}

		const remainingInput = input.substring(firstResult.length);
		const secondResult = second(remainingInput);
		if (isFailure(secondResult)) {
			return {
				...secondResult,
				length: firstResult.length + secondResult.length
			};
		}

		return concatenate(firstResult, secondResult);
	};
}

function and(...scanners: [Scanner, Scanner, ...Scanner[]]): Scanner {
	return scanners.reduce(combineAnd);
}

function combineOr(first: Scanner, second: Scanner): Scanner {
	return input => {
		const firstResult = first(input);
		if (isSuccess(firstResult)) {
			return firstResult;
		} else {
			const secondResult = second(input);
			if (isSuccess(secondResult)) {
				return secondResult;
			} else {
				// Return the error that covers more input text.
				if (firstResult.length >= secondResult.length) {
					return firstResult;
				} else {
					return secondResult;
				}
			}
		}
	};
}

function or(...scanners: [Scanner, Scanner, ...Scanner[]]): Scanner {
	return scanners.reduce(combineOr);
}

function combineLongest(first: Scanner, second: Scanner): Scanner {
	return input => {
		const firstResult = first(input);
		const secondResult = second(input);
		if (isFailure(firstResult) && isFailure(secondResult)) {
			// Return the error that covers more input text.
			if (firstResult.length >= secondResult.length) {
				return firstResult;
			} else {
				return secondResult;
			}
		} else if (isFailure(secondResult)) {
			return firstResult;
		} else if (isFailure(firstResult)) {
			return secondResult;
		} else if (firstResult.length > secondResult.length) {
			return firstResult;
		} else {
			return secondResult;
		}
	};
}

function longest(...scanners: [Scanner, Scanner, ...Scanner[]]): Scanner {
	return scanners.reduce(combineLongest);
}

function zeroOrMore(scanner: Scanner): Scanner {
	const zeroOrMoreScanner = (input: string): ScanSuccess => {
		const result = optional(scanner)(input);
		if (isFailure(result) || (isSuccess(result) && result.length === 0)) {
			return emptyResult;
		} else {
			const remainingInput = input.substring(result.length);
			return concatenate(result, zeroOrMoreScanner(remainingInput));
		}
	};
	return zeroOrMoreScanner;
}

function oneOrMore(scanner: Scanner): Scanner {
	return combineAnd(scanner, zeroOrMore(scanner));
}

function optional(scanner: Scanner): Scanner {
	return or(scanner, nothing);
}

function butNot(scanner: Scanner, not: Scanner): Scanner {
	return input => {
		const result = scanner(input);
		if (isSuccess(result)) {
			if (isSuccess(not(input))) {
				return {
					success: false,
					length: result.length,
					syntaxKind: SyntaxKind.Unknown
				} as const;
			}
		}
		return result;
	};
}

function lookaheadNot(scanner: Scanner, notFollowedBy: Scanner): Scanner {
	return input => {
		const result = scanner(input);
		if (isSuccess(result)) {
			const remainingInput = input.substring(result.length);
			if (isSuccess(notFollowedBy(remainingInput))) {
				return {
					success: false,
					length: result.length,
					syntaxKind: SyntaxKind.Unknown
				} as const;
			}
		}
		return result;
	};
}

const emptyResult: ScanSuccess = {
	success: true,
	length: 0,
	syntaxKind: SyntaxKind.Unknown
};

function nothing(): ScanSuccess {
	return emptyResult;
}

// HexDigit :: one of
// 	0 1 2 3 4 5 6 7 8 9 a b c d e f A B C D E F
function hexDigit(input: string): ScanResult {
	return match(/^[0-9a-fA-F]/)(input);
}

// DecimalDigit :: one of
// 	0 1 2 3 4 5 6 7 8 9
function decimalDigit(input: string): ScanResult {
	return match(/^[0-9]/)(input);
}

// NonZeroDigit :: one of
// 	1 2 3 4 5 6 7 8 9
function nonZeroDigit(input: string): ScanResult {
	return match(/^[1-9]/)(input);
}

// ExponentIndicator :: one of
// 	e E
function exponentIndicator(input: string): ScanResult {
	return or(literal('e'), literal('E'))(input);
}

// HexIntegerLiteral ::
// 	0x HexDigit
// 	0X HexDigit
// 	HexIntegerLiteral HexDigit
function hexIntegerLiteral(input: string): ScanResult {
	return or(
		and(literal('0x'), oneOrMore(hexDigit)),
		and(literal('0X'), oneOrMore(hexDigit))
	)(input);
}

// DecimalDigits ::
// 	DecimalDigit
// 	DecimalDigits DecimalDigit
function decimalDigits(input: string): ScanResult {
	return oneOrMore(decimalDigit)(input);
}

// SignedInteger ::
// 	DecimalDigits
// 	+ DecimalDigits
// 	- DecimalDigits
function signedInteger(input: string): ScanResult {
	return or(
		decimalDigits,
		and(literal('+'), decimalDigits),
		and(literal('-'), decimalDigits)
	)(input);
}

// ExponentPart ::
// 	ExponentIndicator SignedInteger
function exponentPart(input: string): ScanResult {
	return and(exponentIndicator, signedInteger)(input);
}

// DecimalIntegerLiteral ::
// 	0
// 	NonZeroDigit DecimalDigits(opt)
function decimalIntegerLiteral(input: string): ScanResult {
	return or(literal('0'), and(nonZeroDigit, optional(decimalDigits)))(input);
}

// DecimalLiteral ::
// 	DecimalIntegerLiteral . DecimalDigits(opt) ExponentPart(opt)
// 	. DecimalDigits ExponentPart(opt)
// 	DecimalIntegerLiteral ExponentPart(opt)
function decimalLiteral(input: string): ScanResult {
	return or(
		and(
			decimalIntegerLiteral,
			literal('.'),
			optional(decimalDigits),
			optional(exponentPart)
		),
		and(literal('.'), decimalDigits, optional(exponentPart)),
		and(decimalIntegerLiteral, optional(exponentPart))
	)(input);
}

// NumericLiteral ::
// 	DecimalLiteral
// 	HexIntegerLiteral
function numericLiteral(input: string): ScanResult {
	return withSyntaxKind(
		SyntaxKind.NumericLiteral,
		or(hexIntegerLiteral, decimalLiteral)
	)(input);
}

// Infinity
function infinityLiteral(input: string): ScanResult {
	return withSyntaxKind(SyntaxKind.InfinityKeyword, literal('Infinity'))(input);
}

// NaN
function nanLiteral(input: string): ScanResult {
	return withSyntaxKind(SyntaxKind.NaNKeyword, literal('NaN'))(input);
}

// JSON5NumericLiteral::
// 	NumericLiteral
// 	Infinity
// 	NaN
function json5NumericLiteral(input: string): ScanResult {
	return or(numericLiteral, infinityLiteral, nanLiteral)(input);
}

// JSON5Number::
// 	JSON5NumericLiteral
// 	+ JSON5NumericLiteral
// 	- JSON5NumericLiteral
function json5Number(input: string): ScanResult {
	return or(
		json5NumericLiteral,
		withSyntaxKind(
			SyntaxKind.NumericLiteral,
			and(literal('+'), json5NumericLiteral)
		),
		withSyntaxKind(
			SyntaxKind.NumericLiteral,
			and(literal('-'), json5NumericLiteral)
		)
	)(input);
}

// LineTerminator ::
// 	<LF>
// 	<CR>
// 	<LS>
// 	<PS>
function lineTerminator(input: string): ScanResult {
	return withSyntaxKind(
		SyntaxKind.LineBreakTrivia,
		or(literal('\n'), literal('\r'), literal('\u2028'), literal('\u2029'))
	)(input);
}

// LineContinuation ::
// 	\ LineTerminatorSequence
function lineContinuation(input: string): ScanResult {
	return and(literal('\\'), lineTerminatorSequence)(input);
}

// HexEscapeSequence ::
// 	x HexDigit HexDigit
function hexEscapeSequence(input: string): ScanResult {
	return and(literal('x'), hexDigit, hexDigit)(input);
}

// UnicodeEscapeSequence ::
// 	u HexDigit HexDigit HexDigit HexDigit
function unicodeEscapeSequence(input: string): ScanResult {
	return and(literal('u'), hexDigit, hexDigit, hexDigit, hexDigit)(input);
}

// EscapeCharacter ::
// 	SingleEscapeCharacter
// 	DecimalDigit
// 	x
// 	u
function escapeCharacter(input: string): ScanResult {
	return or(
		singleEscapeCharacter,
		decimalDigit,
		literal('x'),
		literal('u')
	)(input);
}

// SingleEscapeCharacter :: one of
// 	' " \ b f n r t v
function singleEscapeCharacter(input: string): ScanResult {
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
function sourceCharacter(input: string): ScanResult {
	const codePoint = input.codePointAt(0);
	if (codePoint !== undefined) {
		return {
			success: true,
			length: String.fromCodePoint(codePoint).length,
			syntaxKind: SyntaxKind.Unknown
		};
	} else {
		return {
			success: false,
			length: 0,
			syntaxKind: SyntaxKind.Unknown
		};
	}
}

// NonEscapeCharacter ::
// 	SourceCharacter but not one of EscapeCharacter or LineTerminator
function nonEscapeCharacter(input: string): ScanResult {
	return butNot(sourceCharacter, or(escapeCharacter, lineTerminator))(input);
}

// CharacterEscapeSequence ::
// 	SingleEscapeCharacter
// 	NonEscapeCharacter
function characterEscapeSequence(input: string): ScanResult {
	return or(singleEscapeCharacter, nonEscapeCharacter)(input);
}

// EscapeSequence ::
// 	CharacterEscapeSequence
// 	0 [lookahead ∉ DecimalDigit]
// 	HexEscapeSequence
// 	UnicodeEscapeSequence
function escapeSequence(input: string): ScanResult {
	return or(
		characterEscapeSequence,
		lookaheadNot(literal('0'), decimalDigit),
		hexEscapeSequence,
		unicodeEscapeSequence
	)(input);
}

// JSON5SingleStringCharacter::
// 	SourceCharacter but not one of ' or \ or LineTerminator
// 	\ EscapeSequence
// 	LineContinuation
// 	U+2028
// 	U+2029
function json5SingleStringCharacter(input: string): ScanResult {
	return or(
		butNot(sourceCharacter, or(literal("'"), literal('\\'), lineTerminator)),
		and(literal('\\'), escapeSequence),
		lineContinuation,
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
function json5DoubleStringCharacter(input: string): ScanResult {
	return or(
		butNot(sourceCharacter, or(literal('"'), literal('\\'), lineTerminator)),
		and(literal('\\'), escapeSequence),
		lineContinuation,
		literal('\u2028'),
		literal('\u2029')
	)(input);
}

// JSON5SingleStringCharacters::
// 	JSON5SingleStringCharacter JSON5SingleStringCharacters(opt)
function json5SingleStringCharacters(input: string): ScanResult {
	return oneOrMore(json5SingleStringCharacter)(input);
}

// JSON5DoubleStringCharacters::
// 	JSON5DoubleStringCharacter JSON5DoubleStringCharacters(opt)
function json5DoubleStringCharacters(input: string): ScanResult {
	return oneOrMore(json5DoubleStringCharacter)(input);
}

// JSON5String::
// 	"JSON5DoubleStringCharacters(opt)"
// 	'JSON5SingleStringCharacters(opt)'
function json5String(input: string): ScanResult {
	return withSyntaxKind(
		SyntaxKind.StringLiteral,
		or(
			and(literal('"'), zeroOrMore(json5DoubleStringCharacters), literal('"')),
			and(literal("'"), zeroOrMore(json5SingleStringCharacters), literal("'"))
		)
	)(input);
}

// true
function trueLiteral(input: string): ScanResult {
	return withSyntaxKind(SyntaxKind.TrueKeyword, literal('true'))(input);
}

// false
function falseLiteral(input: string): ScanResult {
	return withSyntaxKind(SyntaxKind.FalseKeyword, literal('false'))(input);
}

// BooleanLiteral ::
// 	true
// 	false
function booleanLiteral(input: string): ScanResult {
	return or(trueLiteral, falseLiteral)(input);
}

// JSON5Boolean ::
// 	BooleanLiteral
function json5Boolean(input: string): ScanResult {
	return booleanLiteral(input);
}

// NullLiteral ::
// 	null
function nullLiteral(input: string): ScanResult {
	return withSyntaxKind(SyntaxKind.NullKeyword, literal('null'))(input);
}

// JSON5Null ::
//	NullLiteral
function json5Null(input: string): ScanResult {
	return nullLiteral(input);
}

// JSON5Punctuator :: one of
//	{ } [ ] : ,
function json5Punctuator(input: string): ScanResult {
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
function unicodeConnectorPunctuation(input: string): ScanResult {
	return match(/^\p{Pc}/u)(input);
}

// UnicodeDigit ::
// 	any character in the Unicode category "Decimal number (Nd)"
function unicodeDigit(input: string): ScanResult {
	return match(/^\p{Nd}/u)(input);
}

// UnicodeCombiningMark ::
// 	any character in the Unicode categories "Non-spacing mark (Mn)" or
// 		"Combining spacing mark (Mc)"
function unicodeCombiningMark(input: string): ScanResult {
	return match(/^\p{Mn}|^\p{Mc}/u)(input);
}

// UnicodeLetter ::
// 	any character in the Unicode categories "Uppercase letter (Lu)", "Lowercase
//		letter (Ll)", "Titlecase letter (Lt)", "Modifier letter (Lm)", "Other
//		letter (Lo)", or "Letter number (Nl)".
function unicodeLetter(input: string): ScanResult {
	return match(/^\p{Lu}|^\p{Ll}|^\p{Lt}|^\p{Lm}|^\p{Lo}|^\p{Nl}/u)(input);
}

// IdentifierStart ::
// 	UnicodeLetter
// 	$
// 	_
// 	\ UnicodeEscapeSequence
function identifierStart(input: string): ScanResult {
	return or(
		unicodeLetter,
		literal('$'),
		literal('_'),
		and(literal('\\'), unicodeEscapeSequence)
	)(input);
}

// IdentifierPart ::
// 	IdentifierStart
// 	UnicodeCombiningMark
// 	UnicodeDigit
// 	UnicodeConnectorPunctuation
// 	<ZWNJ>
// 	<ZWJ>
function identifierPart(input: string): ScanResult {
	return or(
		identifierStart,
		unicodeCombiningMark,
		unicodeDigit,
		unicodeConnectorPunctuation,
		literal('\u200C'),
		literal('\u200D')
	)(input);
}

// IdentifierName ::
// 	IdentifierStart
// 	IdentifierName IdentifierPart
function identifierName(input: string): ScanResult {
	// Note: this doesn't exactly follow the grammar to avoid recursion.
	return or(
		and(identifierStart, oneOrMore(identifierPart)),
		identifierStart
	)(input);
}

// JSON5Identifier ::
//	IdentifierName
function json5Identifier(input: string): ScanResult {
	// Note: this doesn't exactly follow the grammar to get specific kinds for
	// keywords.
	return longest(
		withSyntaxKind(SyntaxKind.Identifier, identifierName),
		nullLiteral,
		trueLiteral,
		falseLiteral,
		infinityLiteral,
		nanLiteral
	)(input);
}

// JSON5Token ::
// 	JSON5Identifier
// 	JSON5Punctuator
// 	JSON5String
// 	JSON5Number
function json5Token(input: string): ScanResult {
	return or(json5Identifier, json5Punctuator, json5String, json5Number)(input);
}

// SingleLineCommentChar ::
// 	SourceCharacter but not LineTerminator
function singleLineCommentChar(input: string): ScanResult {
	return butNot(sourceCharacter, lineTerminator)(input);
}

// SingleLineCommentChars ::
// 	SingleLineCommentChar SingleLineCommentChars(opt)
function singleLineCommentChars(input: string): ScanResult {
	return and(singleLineCommentChar, optional(singleLineCommentChars))(input);
}

// SingleLineComment ::
// 	// SingleLineCommentChars(opt)
function singleLineComment(input: string): ScanResult {
	return withSyntaxKind(
		SyntaxKind.LineCommentTrivia,
		and(literal('//'), optional(singleLineCommentChars))
	)(input);
}

// MultiLineNotForwardSlashOrAsteriskChar ::
// 	SourceCharacter but not one of / or *
function multiLineNotForwardSlashOrAsteriskChar(input: string): ScanResult {
	return butNot(sourceCharacter, or(literal('/'), literal('*')))(input);
}

// MultiLineNotAsteriskChar ::
// 	SourceCharacter but not *
function multiLineNotAsteriskChar(input: string): ScanResult {
	return butNot(sourceCharacter, literal('*'))(input);
}

// PostAsteriskCommentChars ::
// 	MultiLineNotForwardSlashOrAsteriskChar MultiLineCommentChars(opt)
// 	* PostAsteriskCommentChars(opt)
function postAsteriskCommentChars(input: string): ScanResult {
	return or(
		and(
			multiLineNotForwardSlashOrAsteriskChar,
			optional(multiLineCommentChars)
		),
		and(literal('*'), optional(postAsteriskCommentChars))
	)(input);
}

// MultiLineCommentChars ::
// 	MultiLineNotAsteriskChar MultiLineCommentChars(opt)
// 	* PostAsteriskCommentChars(opt)
function multiLineCommentChars(input: string): ScanResult {
	// Note: this doesn't exactly follow the grammar because the final '*' from
	// '*/' should not be part of the lexeme.
	return oneOrMore(
		or(multiLineNotAsteriskChar, lookaheadNot(literal('*'), literal('/')))
	)(input);
}

// MultiLineComment ::
// 	/* MultiLineCommentChars(opt) */
function multiLineComment(input: string): ScanResult {
	return withSyntaxKind(
		SyntaxKind.BlockCommentTrivia,
		and(literal('/*'), optional(multiLineCommentChars), literal('*/'))
	)(input);
}

// Comment ::
// 	MultiLineComment
// 	SingleLineComment
function comment(input: string): ScanResult {
	return or(multiLineComment, singleLineComment)(input);
}

// WhiteSpace ::
// 	<TAB>
// 	<VT>
// 	<FF>
// 	<SP>
// 	<NBSP>
// 	<BOM>
// 	<USP>
export function whiteSpace(input: string): ScanResult {
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

// LineTerminatorSequence ::
// 	<LF>
// 	<CR> [lookahead ∉ <LF> ]
// 	<LS>
// 	<PS>
// 	<CR> <LF>
export function lineTerminatorSequence(input: string): ScanResult {
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

// JSON5InputElement ::
// 	WhiteSpace
// 	LineTerminator
// 	Comment
// 	JSON5Token
export function json5InputElement(input: string): ScanResult {
	// Note: this doesn't exactly follow the grammar because we want to treat
	// \r\n as a single token.
	return or(whiteSpace, lineTerminatorSequence, comment, json5Token)(input);
}
