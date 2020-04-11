import { SyntaxKind } from '../main';

export type ScanSuccess = {
	success: true;
	length: number;
	lineBreaksCount: number;
	lengthToEndOfLastLineBreak: number;
	syntaxKind: SyntaxKind;
};
export type ScanFailure = {
	success: false;
	length: number;
	lineBreaksCount: number;
	lengthToEndOfLastLineBreak: number;
	syntaxKind: SyntaxKind;
};
export type ScanResult = ScanSuccess | ScanFailure;

type Scanner = (input: string) => ScanResult;

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

const emptyFailure: ScanFailure = {
	success: false,
	length: 0,
	lineBreaksCount: 0,
	lengthToEndOfLastLineBreak: 0,
	syntaxKind: SyntaxKind.Unknown
};

const emptySuccess: ScanSuccess = {
	success: true,
	length: 0,
	lineBreaksCount: 0,
	lengthToEndOfLastLineBreak: 0,
	syntaxKind: SyntaxKind.Unknown
};

const nothing: Scanner = () => emptySuccess;

function concatenate(
	firstResult: ScanSuccess,
	secondResult: ScanSuccess
): ScanSuccess {
	return {
		success: true,
		length: firstResult.length + secondResult.length,
		lineBreaksCount: firstResult.lineBreaksCount + secondResult.lineBreaksCount,
		lengthToEndOfLastLineBreak:
			secondResult.lineBreaksCount > 0
				? firstResult.length + secondResult.lengthToEndOfLastLineBreak
				: firstResult.lengthToEndOfLastLineBreak,
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
				lineBreaksCount: 0,
				lengthToEndOfLastLineBreak: 0,
				syntaxKind: SyntaxKind.Unknown
			};
		} else {
			return emptyFailure;
		}
	};
}

function literalLineBreak(text: string): Scanner {
	return input => {
		if (input.startsWith(text)) {
			return {
				success: true,
				length: text.length,
				lineBreaksCount: 1,
				lengthToEndOfLastLineBreak: text.length,
				syntaxKind: SyntaxKind.Unknown
			};
		} else {
			return emptyFailure;
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
				lineBreaksCount: 0,
				lengthToEndOfLastLineBreak: 0,
				syntaxKind: SyntaxKind.Unknown
			};
		} else {
			return emptyFailure;
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
			return emptySuccess;
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
					lineBreaksCount: result.lineBreaksCount,
					lengthToEndOfLastLineBreak: result.lengthToEndOfLastLineBreak,
					syntaxKind: SyntaxKind.Unknown
				};
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
					lineBreaksCount: result.lineBreaksCount,
					lengthToEndOfLastLineBreak: result.lengthToEndOfLastLineBreak,
					syntaxKind: SyntaxKind.Unknown
				};
			}
		}
		return result;
	};
}

/** Actual JSON5 grammar starts here. See <https://spec.json5.org/>. */

// HexDigit :: one of
// 	0 1 2 3 4 5 6 7 8 9 a b c d e f A B C D E F
const hexDigit: Scanner = match(/^[0-9a-fA-F]/);

// DecimalDigit :: one of
// 	0 1 2 3 4 5 6 7 8 9
const decimalDigit: Scanner = match(/^[0-9]/);

// NonZeroDigit :: one of
// 	1 2 3 4 5 6 7 8 9
const nonZeroDigit: Scanner = match(/^[1-9]/);

// ExponentIndicator :: one of
// 	e E
const exponentIndicator: Scanner = or(literal('e'), literal('E'));

// HexIntegerLiteral ::
// 	0x HexDigit
// 	0X HexDigit
// 	HexIntegerLiteral HexDigit
const hexIntegerLiteral: Scanner = or(
	and(literal('0x'), oneOrMore(hexDigit)),
	and(literal('0X'), oneOrMore(hexDigit))
);

// DecimalDigits ::
// 	DecimalDigit
// 	DecimalDigits DecimalDigit
const decimalDigits: Scanner = oneOrMore(decimalDigit);

// SignedInteger ::
// 	DecimalDigits
// 	+ DecimalDigits
// 	- DecimalDigits
const signedInteger: Scanner = or(
	decimalDigits,
	and(literal('+'), decimalDigits),
	and(literal('-'), decimalDigits)
);

// ExponentPart ::
// 	ExponentIndicator SignedInteger
const exponentPart: Scanner = and(exponentIndicator, signedInteger);

// DecimalIntegerLiteral ::
// 	0
// 	NonZeroDigit DecimalDigits(opt)
const decimalIntegerLiteral: Scanner = or(
	literal('0'),
	and(nonZeroDigit, optional(decimalDigits))
);

// DecimalLiteral ::
// 	DecimalIntegerLiteral . DecimalDigits(opt) ExponentPart(opt)
// 	. DecimalDigits ExponentPart(opt)
// 	DecimalIntegerLiteral ExponentPart(opt)
const decimalLiteral: Scanner = or(
	and(
		decimalIntegerLiteral,
		literal('.'),
		optional(decimalDigits),
		optional(exponentPart)
	),
	and(literal('.'), decimalDigits, optional(exponentPart)),
	and(decimalIntegerLiteral, optional(exponentPart))
);

// NumericLiteral ::
// 	DecimalLiteral
// 	HexIntegerLiteral
const numericLiteral: Scanner = withSyntaxKind(
	SyntaxKind.NumericLiteral,
	or(hexIntegerLiteral, decimalLiteral)
);

// Infinity
const infinityLiteral: Scanner = withSyntaxKind(
	SyntaxKind.InfinityKeyword,
	literal('Infinity')
);

// NaN
const nanLiteral: Scanner = withSyntaxKind(
	SyntaxKind.NaNKeyword,
	literal('NaN')
);

// JSON5NumericLiteral ::
// 	NumericLiteral
// 	Infinity
// 	NaN
const json5NumericLiteral: Scanner = or(
	numericLiteral,
	infinityLiteral,
	nanLiteral
);

// JSON5Number ::
// 	JSON5NumericLiteral
// 	+ JSON5NumericLiteral
// 	- JSON5NumericLiteral
const json5Number: Scanner = or(
	json5NumericLiteral,
	withSyntaxKind(
		SyntaxKind.NumericLiteral,
		and(literal('+'), json5NumericLiteral)
	),
	withSyntaxKind(
		SyntaxKind.NumericLiteral,
		and(literal('-'), json5NumericLiteral)
	)
);

// LineTerminator ::
// 	<LF>
// 	<CR>
// 	<LS>
// 	<PS>
const lineTerminator: Scanner = withSyntaxKind(
	SyntaxKind.LineBreakTrivia,
	or(
		literalLineBreak('\n'),
		literalLineBreak('\r'),
		literalLineBreak('\u2028'),
		literalLineBreak('\u2029')
	)
);

// LineTerminatorSequence ::
// 	<LF>
// 	<CR> [lookahead ∉ <LF> ]
// 	<LS>
// 	<PS>
// 	<CR> <LF>
const lineTerminatorSequence: Scanner = withSyntaxKind(
	SyntaxKind.LineBreakTrivia,
	or(
		literalLineBreak('\n'),
		lookaheadNot(literalLineBreak('\r'), literalLineBreak('\n')),
		literalLineBreak('\u2028'),
		literalLineBreak('\u2029'),
		literalLineBreak('\r\n')
	)
);

// LineContinuation ::
// 	\ LineTerminatorSequence
const lineContinuation: Scanner = and(literal('\\'), lineTerminatorSequence);

// HexEscapeSequence ::
// 	x HexDigit HexDigit
const hexEscapeSequence: Scanner = and(literal('x'), hexDigit, hexDigit);

// UnicodeEscapeSequence ::
// 	u HexDigit HexDigit HexDigit HexDigit
const unicodeEscapeSequence: Scanner = and(
	literal('u'),
	hexDigit,
	hexDigit,
	hexDigit,
	hexDigit
);

// SingleEscapeCharacter :: one of
// 	' " \ b f n r t v
const singleEscapeCharacter: Scanner = or(
	literal("'"),
	literal('"'),
	literal('\\'),
	literal('b'),
	literal('f'),
	literal('n'),
	literal('r'),
	literal('t'),
	literal('v')
);

// EscapeCharacter ::
// 	SingleEscapeCharacter
// 	DecimalDigit
// 	x
// 	u
const escapeCharacter: Scanner = or(
	singleEscapeCharacter,
	decimalDigit,
	literal('x'),
	literal('u')
);

// SourceCharacter ::
// 	any Unicode code unit
const sourceCharacter: Scanner = input => {
	const codePoint = input.codePointAt(0);
	if (codePoint !== undefined) {
		return {
			success: true,
			length: String.fromCodePoint(codePoint).length,
			lineBreaksCount: 0,
			lengthToEndOfLastLineBreak: 0,
			syntaxKind: SyntaxKind.Unknown
		};
	} else {
		return {
			success: false,
			length: 0,
			lineBreaksCount: 0,
			lengthToEndOfLastLineBreak: 0,
			syntaxKind: SyntaxKind.Unknown
		};
	}
};

// NonEscapeCharacter ::
// 	SourceCharacter but not one of EscapeCharacter or LineTerminator
const nonEscapeCharacter: Scanner = butNot(
	sourceCharacter,
	or(escapeCharacter, lineTerminator)
);

// CharacterEscapeSequence ::
// 	SingleEscapeCharacter
// 	NonEscapeCharacter
const characterEscapeSequence: Scanner = or(
	singleEscapeCharacter,
	nonEscapeCharacter
);

// EscapeSequence ::
// 	CharacterEscapeSequence
// 	0 [lookahead ∉ DecimalDigit]
// 	HexEscapeSequence
// 	UnicodeEscapeSequence
const escapeSequence: Scanner = or(
	characterEscapeSequence,
	lookaheadNot(literal('0'), decimalDigit),
	hexEscapeSequence,
	unicodeEscapeSequence
);

// JSON5SingleStringCharacter ::
// 	SourceCharacter but not one of ' or \ or LineTerminator
// 	\ EscapeSequence
// 	LineContinuation
// 	U+2028
// 	U+2029
const json5SingleStringCharacter: Scanner = or(
	butNot(sourceCharacter, or(literal("'"), literal('\\'), lineTerminator)),
	and(literal('\\'), escapeSequence),
	lineContinuation,
	literal('\u2028'),
	literal('\u2029')
);

// JSON5DoubleStringCharacter ::
// 	SourceCharacter but not one of " or \ or LineTerminator
// 	\ EscapeSequence
// 	LineContinuation
// 	U+2028
// 	U+2029
const json5DoubleStringCharacter: Scanner = or(
	butNot(sourceCharacter, or(literal('"'), literal('\\'), lineTerminator)),
	and(literal('\\'), escapeSequence),
	lineContinuation,
	literal('\u2028'),
	literal('\u2029')
);

// JSON5SingleStringCharacters ::
// 	JSON5SingleStringCharacter JSON5SingleStringCharacters(opt)
const json5SingleStringCharacters: Scanner = oneOrMore(
	json5SingleStringCharacter
);

// JSON5DoubleStringCharacters ::
// 	JSON5DoubleStringCharacter JSON5DoubleStringCharacters(opt)
const json5DoubleStringCharacters: Scanner = oneOrMore(
	json5DoubleStringCharacter
);

// JSON5String ::
// 	"JSON5DoubleStringCharacters(opt)"
// 	'JSON5SingleStringCharacters(opt)'
const json5String: Scanner = withSyntaxKind(
	SyntaxKind.StringLiteral,
	or(
		and(literal('"'), zeroOrMore(json5DoubleStringCharacters), literal('"')),
		and(literal("'"), zeroOrMore(json5SingleStringCharacters), literal("'"))
	)
);

// true
const trueLiteral: Scanner = withSyntaxKind(
	SyntaxKind.TrueKeyword,
	literal('true')
);

// false
const falseLiteral: Scanner = withSyntaxKind(
	SyntaxKind.FalseKeyword,
	literal('false')
);

// BooleanLiteral ::
// 	true
// 	false
const booleanLiteral: Scanner = or(trueLiteral, falseLiteral);

// JSON5Boolean ::
// 	BooleanLiteral
const json5Boolean: Scanner = booleanLiteral;

// NullLiteral ::
// 	null
const nullLiteral: Scanner = withSyntaxKind(
	SyntaxKind.NullKeyword,
	literal('null')
);

// JSON5Null ::
//	NullLiteral
const json5Null: Scanner = nullLiteral;

// JSON5Punctuator :: one of
//	{ } [ ] : ,
const json5Punctuator: Scanner = or(
	withSyntaxKind(SyntaxKind.OpenBraceToken, literal('{')),
	withSyntaxKind(SyntaxKind.CloseBraceToken, literal('}')),
	withSyntaxKind(SyntaxKind.OpenBracketToken, literal('[')),
	withSyntaxKind(SyntaxKind.CloseBracketToken, literal(']')),
	withSyntaxKind(SyntaxKind.ColonToken, literal(':')),
	withSyntaxKind(SyntaxKind.CommaToken, literal(','))
);

// UnicodeConnectorPunctuation ::
// 	any character in the Unicode category "Connector punctuation (Pc)"
const unicodeConnectorPunctuation: Scanner = match(/^\p{Pc}/u);

// UnicodeDigit ::
// 	any character in the Unicode category "Decimal number (Nd)"
const unicodeDigit: Scanner = match(/^\p{Nd}/u);

// UnicodeCombiningMark ::
// 	any character in the Unicode categories "Non-spacing mark (Mn)" or
// 		"Combining spacing mark (Mc)"
const unicodeCombiningMark: Scanner = match(/^\p{Mn}|^\p{Mc}/u);

// UnicodeLetter ::
// 	any character in the Unicode categories "Uppercase letter (Lu)", "Lowercase
//		letter (Ll)", "Titlecase letter (Lt)", "Modifier letter (Lm)", "Other
//		letter (Lo)", or "Letter number (Nl)".
const unicodeLetter: Scanner = match(
	/^\p{Lu}|^\p{Ll}|^\p{Lt}|^\p{Lm}|^\p{Lo}|^\p{Nl}/u
);

// IdentifierStart ::
// 	UnicodeLetter
// 	$
// 	_
// 	\ UnicodeEscapeSequence
const identifierStart: Scanner = or(
	unicodeLetter,
	literal('$'),
	literal('_'),
	and(literal('\\'), unicodeEscapeSequence)
);

// IdentifierPart ::
// 	IdentifierStart
// 	UnicodeCombiningMark
// 	UnicodeDigit
// 	UnicodeConnectorPunctuation
// 	<ZWNJ>
// 	<ZWJ>
const identifierPart: Scanner = or(
	identifierStart,
	unicodeCombiningMark,
	unicodeDigit,
	unicodeConnectorPunctuation,
	literal('\u200C'),
	literal('\u200D')
);

// IdentifierName ::
// 	IdentifierStart
// 	IdentifierName IdentifierPart
//
// Note: this doesn't exactly follow the grammar to avoid recursion.
const identifierName: Scanner = or(
	and(identifierStart, oneOrMore(identifierPart)),
	identifierStart
);

// JSON5Identifier ::
//	IdentifierName
//
// Note: this doesn't exactly follow the grammar to get specific kinds for
// keywords.
const json5Identifier: Scanner = longest(
	withSyntaxKind(SyntaxKind.Identifier, identifierName),
	nullLiteral,
	trueLiteral,
	falseLiteral,
	infinityLiteral,
	nanLiteral
);

// JSON5Token ::
// 	JSON5Identifier
// 	JSON5Punctuator
// 	JSON5String
// 	JSON5Number
const json5Token: Scanner = or(
	json5Identifier,
	json5Punctuator,
	json5String,
	json5Number
);

// SingleLineCommentChar ::
// 	SourceCharacter but not LineTerminator
const singleLineCommentChar: Scanner = butNot(sourceCharacter, lineTerminator);

// SingleLineCommentChars ::
// 	SingleLineCommentChar SingleLineCommentChars(opt)
// Note: this doesn't exactly follow the grammar to avoid recursion.
const singleLineCommentChars: Scanner = oneOrMore(singleLineCommentChar);

// SingleLineComment ::
// 	// SingleLineCommentChars(opt)
const singleLineComment: Scanner = withSyntaxKind(
	SyntaxKind.LineCommentTrivia,
	and(literal('//'), optional(singleLineCommentChars))
);

// MultiLineNotForwardSlashOrAsteriskChar ::
// 	SourceCharacter but not one of / or *
//
// Not used.

// MultiLineNotAsteriskChar ::
// 	SourceCharacter but not *
//
// Note: this doesn't exactly follow the grammar because we want to keep track
// of line breaks.
const multiLineNotAsteriskChar: Scanner = or(
	lineTerminatorSequence,
	butNot(sourceCharacter, literal('*'))
);

// MultiLineCommentChars ::
// 	MultiLineNotAsteriskChar MultiLineCommentChars(opt)
// 	* PostAsteriskCommentChars(opt)
//
// Note: this doesn't exactly follow the grammar because the final '*' from
// '*/' should not be part of the lexeme.
const multiLineCommentChars: Scanner = oneOrMore(
	or(multiLineNotAsteriskChar, lookaheadNot(literal('*'), literal('/')))
);

// PostAsteriskCommentChars ::
// 	MultiLineNotForwardSlashOrAsteriskChar MultiLineCommentChars(opt)
// 	* PostAsteriskCommentChars(opt)
//
// Not used.

// MultiLineComment ::
// 	/* MultiLineCommentChars(opt) */
const multiLineComment: Scanner = withSyntaxKind(
	SyntaxKind.BlockCommentTrivia,
	and(literal('/*'), optional(multiLineCommentChars), literal('*/'))
);

// Comment ::
// 	MultiLineComment
// 	SingleLineComment
const comment: Scanner = or(multiLineComment, singleLineComment);

// WhiteSpace ::
// 	<TAB>
// 	<VT>
// 	<FF>
// 	<SP>
// 	<NBSP>
// 	<BOM>
// 	<USP>
//
// Note: this doesn't exactly follow the grammar because we want to treat
// contiguous whitespace as one token.
const whiteSpace: Scanner = withSyntaxKind(
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
);

// JSON5InputElement ::
// 	WhiteSpace
// 	LineTerminator
// 	Comment
// 	JSON5Token
//
// Note: this doesn't exactly follow the grammar because we want to treat
// '\r\n' as a single token.
export const json5InputElement: Scanner = or(
	whiteSpace,
	lineTerminatorSequence,
	comment,
	json5Token
);
