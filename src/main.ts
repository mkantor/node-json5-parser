/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as scanner from './impl/scanner';
import * as parser from './impl/parser';

/**
 * Creates a JSON scanner on the given text.
 * If ignoreTrivia is set, whitespaces or comments are ignored.
 */
export const createScanner: (text: string, ignoreTrivia?: boolean) => JSONScanner = scanner.createScanner;

export const enum ScanError {
	None = 0,
	UnexpectedEndOfComment = 1,
	UnexpectedEndOfString = 2,
	UnexpectedEndOfNumber = 3,
	InvalidUnicode = 4,
	InvalidEscapeCharacter = 5,
	InvalidCharacter = 6
}

export function printScanError(code: ScanError): string {
	switch (code) {
		case ScanError.None: return 'None';
		case ScanError.UnexpectedEndOfComment: return 'UnexpectedEndOfComment';
		case ScanError.UnexpectedEndOfString: return 'UnexpectedEndOfString';
		case ScanError.UnexpectedEndOfNumber: return 'UnexpectedEndOfNumber';
		case ScanError.InvalidUnicode: return 'InvalidUnicode';
		case ScanError.InvalidEscapeCharacter: return 'InvalidEscapeCharacter';
		case ScanError.InvalidCharacter: return 'InvalidCharacter';
	}
}

export const enum SyntaxKind {
	OpenBraceToken = 1,
	CloseBraceToken = 2,
	OpenBracketToken = 3,
	CloseBracketToken = 4,
	CommaToken = 5,
	ColonToken = 6,
	NullKeyword = 7,
	TrueKeyword = 8,
	FalseKeyword = 9,
	StringLiteral = 10,
	NumericLiteral = 11,
	LineCommentTrivia = 12,
	BlockCommentTrivia = 13,
	LineBreakTrivia = 14,
	Trivia = 15,
	Unknown = 16,
	EOF = 17,
	Identifier = 18,
	InfinityKeyword = 19,
	NaNKeyword = 20
}

export function printSyntaxKind(code: SyntaxKind): string {
	switch (code) {
		case SyntaxKind.OpenBraceToken: return 'OpenBraceToken';
		case SyntaxKind.CloseBraceToken: return 'CloseBraceToken';
		case SyntaxKind.OpenBracketToken: return 'OpenBracketToken';
		case SyntaxKind.CloseBracketToken: return 'CloseBracketToken';
		case SyntaxKind.CommaToken: return 'CommaToken';
		case SyntaxKind.ColonToken: return 'ColonToken';
		case SyntaxKind.NullKeyword: return 'NullKeyword';
		case SyntaxKind.TrueKeyword: return 'TrueKeyword';
		case SyntaxKind.FalseKeyword: return 'FalseKeyword';
		case SyntaxKind.StringLiteral: return 'StringLiteral';
		case SyntaxKind.NumericLiteral: return 'NumericLiteral';
		case SyntaxKind.LineCommentTrivia: return 'LineCommentTrivia';
		case SyntaxKind.BlockCommentTrivia: return 'BlockCommentTrivia';
		case SyntaxKind.LineBreakTrivia: return 'LineBreakTrivia';
		case SyntaxKind.Trivia: return 'Trivia';
		case SyntaxKind.Unknown: return 'Unknown';
		case SyntaxKind.EOF: return 'EOF';
		case SyntaxKind.Identifier: return 'Identifier';
		case SyntaxKind.InfinityKeyword: return 'InfinityKeyword';
		case SyntaxKind.NaNKeyword: return 'NaNKeyword';
	}
}

/**
 * The scanner object, representing a JSON scanner at a position in the input string.
 */
export interface JSONScanner {
	/**
	 * Sets the scan position to a new offset. A call to 'scan' is needed to get the first token.
	 */
	setPosition(pos: number): void;
	/**
	 * Read the next token. Returns the token code.
	 */
	scan(): SyntaxKind;
	/**
	 * Returns the current scan position, which is after the last read token.
	 */
	getPosition(): number;
	/**
	 * Returns the last read token.
	 */
	getToken(): SyntaxKind;
	/**
	 * Returns the last read token value. The value for strings is the decoded string content. For numbers it's of type number, for boolean it's true or false.
	 */
	getTokenValue(): string;
	/**
	 * The start offset of the last read token.
	 */
	getTokenOffset(): number;
	/**
	 * The length of the last read token.
	 */
	getTokenLength(): number;
	/**
	 * The zero-based start line number of the last read token.
	 */
	getTokenStartLine(): number;
	/**
	 * The zero-based start character (column) of the last read token.
	 */
	getTokenStartCharacter(): number;
	/**
	 * An error code of the last scan.
	 */
	getTokenError(): ScanError;
}


/**
 * For a given offset, evaluate the location in the JSON document. Each segment in the location path is either a property name or an array index.
 */
export const getLocation: (text: string, position: number) => Location = parser.getLocation;

/**
 * Parses the given text and returns the object the JSON content represents. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
 * Therefore, always check the errors list to find out if the input was valid.
 */
export const parse: (text: string, errors?: ParseError[], options?: ParseOptions) => any = parser.parse;

/**
 * Parses the given text and returns a tree representation the JSON content. On invalid input, the parser tries to be as fault tolerant as possible, but still return a result.
 */
export const parseTree: (text: string, errors?: ParseError[], options?: ParseOptions) => Node = parser.parseTree;

/**
 * Finds the node at the given path in a JSON DOM.
 */
export const findNodeAtLocation: (root: Node, path: JSONPath) => Node | undefined = parser.findNodeAtLocation;

/**
 * Finds the innermost node at the given offset. If includeRightBound is set, also finds nodes that end at the given offset.
 */
export const findNodeAtOffset: (root: Node, offset: number, includeRightBound?: boolean) => Node | undefined = parser.findNodeAtOffset;

/**
 * Gets the JSON path of the given JSON DOM node
 */
export const getNodePath: (node: Node) => JSONPath = parser.getNodePath;

/**
 * Evaluates the JavaScript object of the given JSON DOM node 
 */
export const getNodeValue: (node: Node) => any = parser.getNodeValue;

/**
 * Parses the given text and invokes the visitor functions for each object, array and literal reached.
 */
export const visit: (text: string, visitor: JSONVisitor, options?: ParseOptions) => any = parser.visit;

/**
 * Takes JSON with JavaScript-style comments and remove
 * them. Optionally replaces every none-newline character
 * of comments with a replaceCharacter
 */
export const stripComments: (text: string, replaceCh?: string) => string = parser.stripComments;

export interface ParseError {
	error: ParseErrorCode;
	offset: number;
	length: number;
}

export const enum ParseErrorCode {
	InvalidSymbol = 1,
	InvalidNumberFormat = 2,
	PropertyNameExpected = 3,
	ValueExpected = 4,
	ColonExpected = 5,
	CommaExpected = 6,
	CloseBraceExpected = 7,
	CloseBracketExpected = 8,
	EndOfFileExpected = 9,
	InvalidCommentToken = 10,
	UnexpectedEndOfComment = 11,
	UnexpectedEndOfString = 12,
	UnexpectedEndOfNumber = 13,
	InvalidUnicode = 14,
	InvalidEscapeCharacter = 15,
	InvalidCharacter = 16
}

export function printParseErrorCode(code: ParseErrorCode): string {
	switch (code) {
		case ParseErrorCode.InvalidSymbol: return 'InvalidSymbol';
		case ParseErrorCode.InvalidNumberFormat: return 'InvalidNumberFormat';
		case ParseErrorCode.PropertyNameExpected: return 'PropertyNameExpected';
		case ParseErrorCode.ValueExpected: return 'ValueExpected';
		case ParseErrorCode.ColonExpected: return 'ColonExpected';
		case ParseErrorCode.CommaExpected: return 'CommaExpected';
		case ParseErrorCode.CloseBraceExpected: return 'CloseBraceExpected';
		case ParseErrorCode.CloseBracketExpected: return 'CloseBracketExpected';
		case ParseErrorCode.EndOfFileExpected: return 'EndOfFileExpected';
		case ParseErrorCode.InvalidCommentToken: return 'InvalidCommentToken';
		case ParseErrorCode.UnexpectedEndOfComment: return 'UnexpectedEndOfComment';
		case ParseErrorCode.UnexpectedEndOfString: return 'UnexpectedEndOfString';
		case ParseErrorCode.UnexpectedEndOfNumber: return 'UnexpectedEndOfNumber';
		case ParseErrorCode.InvalidUnicode: return 'InvalidUnicode';
		case ParseErrorCode.InvalidEscapeCharacter: return 'InvalidEscapeCharacter';
		case ParseErrorCode.InvalidCharacter: return 'InvalidCharacter';
	}
}

export type NodeType = 'object' | 'array' | 'property' | 'string' | 'number' | 'boolean' | 'null';

export interface Node {
	readonly type: NodeType;
	readonly value?: any;
	readonly offset: number;
	readonly length: number;
	readonly colonOffset?: number;
	readonly parent?: Node;
	readonly children?: Node[];
}

export type Segment = string | number;
export type JSONPath = Segment[];

export interface Location {
	/**
	 * The previous property key or literal value (string, number, boolean or null) or undefined.
	 */
	previousNode?: Node;
	/**
	 * The path describing the location in the JSON document. The path consists of a sequence of strings
	 * representing an object property or numbers for array indices.
	 */
	path: JSONPath;
	/**
	 * Matches the locations path against a pattern consisting of strings (for properties) and numbers (for array indices).
	 * '*' will match a single segment of any property name or index.
	 * '**' will match a sequence of segments of any property name or index, or no segment.
	 */
	matches: (patterns: JSONPath) => boolean;
	/**
	 * If set, the location's offset is at a property key.
	 */
	isAtPropertyKey: boolean;
}

export interface ParseOptions {
	allowEmptyContent?: boolean;
}

export interface JSONVisitor {
	/**
	 * Invoked when an open brace is encountered and an object is started. The offset and length represent the location of the open brace.
	 */
	onObjectBegin?: (offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a property is encountered. The offset and length represent the location of the property name.
	 */
	onObjectProperty?: (property: string, offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a closing brace is encountered and an object is completed. The offset and length represent the location of the closing brace.
	 */
	onObjectEnd?: (offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when an open bracket is encountered. The offset and length represent the location of the open bracket.
	 */
	onArrayBegin?: (offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a closing bracket is encountered. The offset and length represent the location of the closing bracket.
	 */
	onArrayEnd?: (offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a literal value is encountered. The offset and length represent the location of the literal value.
	 */
	onLiteralValue?: (value: any, offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a comma or colon separator is encountered. The offset and length represent the location of the separator.
	 */
	onSeparator?: (character: string, offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked when a line or block comment is encountered. The offset and length represent the location of the comment.
	 */
	onComment?: (offset: number, length: number, startLine: number, startCharacter: number) => void;

	/**
	 * Invoked on an error.
	 */
	onError?: (error: ParseErrorCode, offset: number, length: number, startLine: number, startCharacter: number) => void;
}
