/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import {
	SyntaxKind,
	createScanner,
	parse,
	getLocation,
	Node,
	ParseError,
	parseTree,
	ParseErrorCode,
	ParseOptions,
	Segment,
	findNodeAtLocation,
	getNodeValue,
	getNodePath,
	ScanError,
	Location,
	visit,
	JSONVisitor,
	printSyntaxKind,
	printScanError,
	printParseErrorCode,
} from '../main';
import { truncateSync } from 'fs';
import JSON5 = require('json5');

function printKinds(kinds: SyntaxKind[]): string {
	return JSON5.stringify(kinds.map(printSyntaxKind));
}

function printVisitorErrors(errors: VisitorError[]): string {
	return JSON5.stringify(
		errors.map(error => {
			return {
				...error,
				error: printParseErrorCode(error.error)
			};
		})
	);
}

function assertKinds(text: string, ...kinds: [SyntaxKind, ...SyntaxKind[]]): void {
	const scanner = createScanner(text);
	let kind: SyntaxKind;

	const actualKinds = [];
	while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
		actualKinds.push(kind);
	}
	scanner.setPosition(0);

	const scannedKinds = [];
	while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
		const expectedKind = kinds[scannedKinds.length];
		scannedKinds.push(kind);
		if (expectedKind === undefined) {
			assert.fail(`extra token(s) found in text \`${text}\`, was ${printKinds(actualKinds)} but expected ${printKinds(kinds)}`);
		}
		assert.equal(kind, expectedKind, `kinds were not correct for text \`${text}\`, was ${printKinds(actualKinds)} but expected ${printKinds(kinds)}`);
		assert.equal(scanner.getTokenError(), ScanError.None, `error ${printScanError(scanner.getTokenError())} while scanning text \`${text}\``);
	}
	assert.equal(kinds.length, scannedKinds.length, `wrong number of tokens found in text \`${text}\`, found ${printKinds(scannedKinds)} but expected ${printKinds(kinds)}]`);
}

function assertScanError(text: string, scanError: ScanError, ...kinds: [SyntaxKind, ...SyntaxKind[]]): void {
	const scanner = createScanner(text);
	let kind: SyntaxKind;

	const actualKinds = [];
	while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
		actualKinds.push(kind);
	}
	scanner.setPosition(0);

	scanner.scan();
	const firstExpectedKind = kinds[0];
	const firstActualKind = scanner.getToken();
	assert.equal(firstActualKind, firstExpectedKind, `first kind was not correct for text \`${text}\`, was ${printKinds(actualKinds)} but expected ${printKinds(kinds)}`);
	const actualError = scanner.getTokenError();
	assert.equal(actualError, scanError, `error was not correct for text \`${text}\`, was ${printScanError(actualError)} but expected ${printScanError(scanError)}`);
	const scannedKinds = [firstActualKind];
	while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
		const expectedKind = kinds[scannedKinds.length];
		scannedKinds.push(kind);
		if (expectedKind === undefined) {
			assert.fail(`extra token found in text \`${text}\`, kind: ${printSyntaxKind(kind)} from value \`${scanner.getTokenValue()}\``);
		}
		assert.equal(kind, expectedKind, `kinds were not correct for text \`${text}\`, was ${printKinds(actualKinds)} but expected ${printKinds(kinds)}, token error: ${printScanError(scanner.getTokenError())}`);
	}
	assert.equal(kinds.length, scannedKinds.length, `wrong number of tokens found in text \`${text}\`, found ${printKinds(scannedKinds)} but expected ${printKinds(kinds)}`);
}

function assertValidParse(input: string, expected: any, options?: ParseOptions): void {
	var errors: ParseError[] = [];
	var actual = parse(input, errors, options);

	const friendlyErrors = errors.map(error => {
		return { ...error, type: printParseErrorCode(error.error) };
	});
	assert.deepEqual(errors, [], `errors occurred when parsing \`${input}\`: ${JSON5.stringify(friendlyErrors)}`);
	if (!(Number.isNaN(actual) && Number.isNaN(expected))) {
		assert.deepEqual(actual, expected, `parse result of \`${input}\` was ${JSON5.stringify(actual)}, expected ${JSON5.stringify(expected)}`);
	}
}

function assertInvalidParse(input: string, expected: any, options?: ParseOptions): void {
	var errors: ParseError[] = [];
	var actual = parse(input, errors, options);

	assert(errors.length > 0, `parse result of \`${input}\` had no errors, expected an error`);
	assert.deepEqual(actual, expected, `parse result of \`${input}\` was ${JSON5.stringify(actual)}, expected ${JSON5.stringify(expected)} (with errors)`);
}

function assertTree(input: string, expected: any, expectedErrors: ParseError[] = []): void {
	var errors: ParseError[] = [];
	var actual = parseTree(input, errors);

	assert.deepEqual(errors, expectedErrors, `parse tree had unexpected errors, expected ${JSON5.stringify(expectedErrors)} but got ${JSON5.stringify(errors)}`);
	let checkParent = (node: Node) => {
		if (node.children) {
			for (let child of node.children) {
				assert.equal(node, child.parent, `parse tree was not correct, expected parent of ${child} to be ${node}`);
				delete (<any>child).parent; // delete to avoid recursion in deep equal
				checkParent(child);
			}
		}
	};
	checkParent(actual);

	assert.deepEqual(actual, expected, `parse tree was not correct, was ${JSON5.stringify(actual)} but expected ${JSON5.stringify(expected)}`);
}

interface VisitorCallback {
	id: keyof JSONVisitor,
	text: string;
	startLine: number;
	startCharacter: number;
	arg?: any;
};
interface VisitorError extends ParseError {
	startLine: number;
	startCharacter: number;
}

function assertVisit(input: string, expected: VisitorCallback[], expectedErrors: VisitorError[] = [], disallowComments = false): void {
	let errors: VisitorError[] = [];
	let actuals: VisitorCallback[] = [];
	let noArgHandler = (id: keyof JSONVisitor) => (offset: number, length: number, startLine: number, startCharacter: number) => actuals.push({ id, text: input.substr(offset, length), startLine, startCharacter });
	let oneArgHandler = (id: keyof JSONVisitor) => (arg: any, offset: number, length: number, startLine: number, startCharacter: number) => actuals.push({ id, text: input.substr(offset, length), startLine, startCharacter, arg });
	visit(input, {
		onObjectBegin: noArgHandler('onObjectBegin'),
		onObjectProperty: oneArgHandler('onObjectProperty'),
		onObjectEnd: noArgHandler('onObjectEnd'),
		onArrayBegin: noArgHandler('onArrayBegin'),
		onArrayEnd: noArgHandler('onArrayEnd'),
		onLiteralValue: oneArgHandler('onLiteralValue'),
		onSeparator: oneArgHandler('onSeparator'),
		onComment: noArgHandler('onComment'),
		onError: (error: ParseErrorCode, offset: number, length: number, startLine: number, startCharacter: number) => {
			errors.push({ error, offset, length, startLine, startCharacter })
		}
	}, {
		disallowComments
	});

	assert.deepEqual(errors, expectedErrors, `visitor did not get expected errors, was ${printVisitorErrors(errors)} but expected ${printVisitorErrors(expectedErrors)}`);
	assert.deepEqual(actuals, expected, `visitor did not get expected callbacks, was ${JSON5.stringify(actuals)} but expected ${JSON5.stringify(expected)}`);
}

function assertNodeAtLocation(input: Node, segments: Segment[], expected: any) {
	let actual = findNodeAtLocation(input, segments);
	const actualValue = actual ? getNodeValue(actual) : void 0;
	if (!(Number.isNaN(actualValue) && Number.isNaN(expected))) {
		assert.deepEqual(actualValue, expected);
	}
	if (actual) {
		assert.deepEqual(getNodePath(actual), segments);
	}
}

function assertLocation(input: string, expectedSegments: Segment[], expectedNodeType: string | undefined, expectedCompleteProperty: boolean): void {
	var offset = input.indexOf('|');
	const correctedInput = input.substring(0, offset) + input.substring(offset + 1, input.length);
	var actual = getLocation(correctedInput, offset);
	assert(actual);
	assert.deepEqual(actual.path, expectedSegments, `path was not correct for \`${input}\`, got ${JSON5.stringify(actual.path)} but expected ${JSON5.stringify(expectedSegments)}`);
	assert.equal(actual.previousNode && actual.previousNode.type, expectedNodeType, `type was not correct for \`${input}\`, got ${actual.previousNode && actual.previousNode.type} but expected ${expectedNodeType}`);
	assert.equal(actual.isAtPropertyKey, expectedCompleteProperty, expectedCompleteProperty ? `expected complete property for \`${input}\` but location was not at property key` :  `did not expect complete property for \`${input}\` but location was at property key`);
}

function assertMatchesLocation(input: string, matchingSegments: Segment[], expectedResult = true): void {
	var offset = input.indexOf('|');
	input = input.substring(0, offset) + input.substring(offset + 1, input.length);
	var actual = getLocation(input, offset);
	assert(actual);
	assert.equal(actual.matches(matchingSegments), expectedResult);
}

suite('JSON', () => {
	test('tokens', () => {
		assertKinds('{', SyntaxKind.OpenBraceToken);
		assertKinds('}', SyntaxKind.CloseBraceToken);
		assertKinds('[', SyntaxKind.OpenBracketToken);
		assertKinds(']', SyntaxKind.CloseBracketToken);
		assertKinds(':', SyntaxKind.ColonToken);
		assertKinds(',', SyntaxKind.CommaToken);
	});

	test('strings', () => {
		assertKinds('"test"', SyntaxKind.StringLiteral);
		assertKinds('"\\""', SyntaxKind.StringLiteral);
		assertKinds('"\\/"', SyntaxKind.StringLiteral);
		assertKinds('"\\b"', SyntaxKind.StringLiteral);
		assertKinds('"\\f"', SyntaxKind.StringLiteral);
		assertKinds('"\\n"', SyntaxKind.StringLiteral);
		assertKinds('"\\r"', SyntaxKind.StringLiteral);
		assertKinds('"\\t"', SyntaxKind.StringLiteral);
		assertKinds('"\u88ff"', SyntaxKind.StringLiteral);
		assertKinds('"​\u2028"', SyntaxKind.StringLiteral);

		// unexpected end
		assertScanError('"test', ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral);
		assertScanError('"test\n"', ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral, SyntaxKind.StringLiteral);

	});

	test('numbers', () => {
		assertKinds('0', SyntaxKind.NumericLiteral);
		assertKinds('0.1', SyntaxKind.NumericLiteral);
		assertKinds('-0.1', SyntaxKind.NumericLiteral);
		assertKinds('-1', SyntaxKind.NumericLiteral);
		assertKinds('1', SyntaxKind.NumericLiteral);
		assertKinds('123456789', SyntaxKind.NumericLiteral);
		assertKinds('10', SyntaxKind.NumericLiteral);
		assertKinds('90', SyntaxKind.NumericLiteral);
		assertKinds('90E+123', SyntaxKind.NumericLiteral);
		assertKinds('90e+123', SyntaxKind.NumericLiteral);
		assertKinds('90e-123', SyntaxKind.NumericLiteral);
		assertKinds('90E-123', SyntaxKind.NumericLiteral);
		assertKinds('90E123', SyntaxKind.NumericLiteral);
		assertKinds('90e123', SyntaxKind.NumericLiteral);

		// zero handling
		assertKinds('01', SyntaxKind.NumericLiteral, SyntaxKind.NumericLiteral);
		assertKinds('-01', SyntaxKind.NumericLiteral, SyntaxKind.NumericLiteral);

		// unexpected end
		assertKinds('-', SyntaxKind.Unknown);
	});

	test('keywords: true, false, null', () => {
		assertKinds('true', SyntaxKind.TrueKeyword);
		assertKinds('false', SyntaxKind.FalseKeyword);
		assertKinds('null', SyntaxKind.NullKeyword);


		assertKinds('true false null',
			SyntaxKind.TrueKeyword,
			SyntaxKind.Trivia,
			SyntaxKind.FalseKeyword,
			SyntaxKind.Trivia,
			SyntaxKind.NullKeyword);

		assertKinds('false//hello', SyntaxKind.FalseKeyword, SyntaxKind.LineCommentTrivia);
	});

	test('trivia', () => {
		assertKinds(' ', SyntaxKind.Trivia);
		assertKinds('  \t  ', SyntaxKind.Trivia);
		assertKinds('  \t  \n  \t  ', SyntaxKind.Trivia, SyntaxKind.LineBreakTrivia, SyntaxKind.Trivia);
		assertKinds('\r\n', SyntaxKind.LineBreakTrivia);
		assertKinds('\r', SyntaxKind.LineBreakTrivia);
		assertKinds('\n', SyntaxKind.LineBreakTrivia);
		assertKinds('\n\r', SyntaxKind.LineBreakTrivia, SyntaxKind.LineBreakTrivia);
		assertKinds('\n   \n', SyntaxKind.LineBreakTrivia, SyntaxKind.Trivia, SyntaxKind.LineBreakTrivia);
	});

	test('parse: literals', () => {

		assertValidParse('true', true);
		assertValidParse('false', false);
		assertValidParse('null', null);
		assertValidParse('"foo"', 'foo');
		assertValidParse('"\\"-\\\\-\\/-\\b-\\f-\\n-\\r-\\t"', '"-\\-/-\b-\f-\n-\r-\t');
		assertValidParse('"\\u00DC"', 'Ü');
		assertValidParse('9', 9);
		assertValidParse('-9', -9);
		assertValidParse('0.129', 0.129);
		assertValidParse('23e3', 23e3);
		assertValidParse('1.2E+3', 1.2E+3);
		assertValidParse('1.2E-3', 1.2E-3);
	});

	test('parse: objects', () => {
		assertValidParse('{}', {});
		assertValidParse('{ "foo": true }', { foo: true });
		assertValidParse('{ "bar": 8, "xoo": "foo" }', { bar: 8, xoo: 'foo' });
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} });
		assertValidParse('{ "a": false, "b": true, "c": [ 7.4 ] }', { a: false, b: true, c: [7.4] });
		assertValidParse('{ "lineComment": "//", "blockComment": ["/*", "*/"], "brackets": [ ["{", "}"], ["[", "]"], ["(", ")"] ] }', { lineComment: '//', blockComment: ['/*', '*/'], brackets: [['{', '}'], ['[', ']'], ['(', ')']] });
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} });
		assertValidParse('{ "hello": { "again": { "inside": 5 }, "world": 1 }}', { hello: { again: { inside: 5 }, world: 1 } });
		assertValidParse('{ "": true }', { '': true });
		assertValidParse('{ ":":":" }', { ':': ':' });
	});

	test('parse: arrays', () => {
		assertValidParse('[]', []);
		assertValidParse('[ [],  [ [] ]]', [[], [[]]]);
		assertValidParse('[ 1, 2, 3 ]', [1, 2, 3]);
		assertValidParse('[ { "a": null } ]', [{ a: null }]);
	});

	test('parse: objects with errors', () => {
		assertInvalidParse('{,}', {});
		assertInvalidParse('{ "bar": 8 "xoo": "foo" }', { bar: 8, xoo: 'foo' });
		assertInvalidParse('{ ,"bar": 8 }', { bar: 8 });
		assertInvalidParse('{ ,"bar": 8, "foo" }', { bar: 8 });
		assertInvalidParse('{ "bar": 8, "foo": }', { bar: 8 });
		assertInvalidParse('{ 8, "foo": 9 }', { foo: 9 });
	});

	test('parse: array with errors', () => {
		assertInvalidParse('[,]', []);
		assertInvalidParse('[ 1 2, 3 ]', [1, 2, 3]);
		assertInvalidParse('[ ,1, 2, 3 ]', [1, 2, 3]);
		assertInvalidParse('[ ,1, 2, 3, ]', [1, 2, 3]);
	});

	test('parse: errors', () => {
		assertInvalidParse('', undefined);
		assertInvalidParse('1,1', 1);
	});

	test('parse: disallow comments', () => {
		let options = { disallowComments: true };

		assertValidParse('[ 1, 2, null, "foo" ]', [1, 2, null, 'foo'], options);
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} }, options);

		assertInvalidParse('{ "foo": /*comment*/ true }', { foo: true }, options);
	});

	test('location: properties', () => {
		assertLocation('|{ "foo": "bar" }', [], void 0, false);
		assertLocation('{| "foo": "bar" }', [''], void 0, true);
		assertLocation('{ |"foo": "bar" }', ['foo'], 'property', true);
		assertLocation('{ "foo|": "bar" }', ['foo'], 'property', true);
		assertLocation('{ "foo"|: "bar" }', ['foo'], 'property', true);
		assertLocation('{ "foo": "bar"| }', ['foo'], 'string', false);
		assertLocation('{ "foo":| "bar" }', ['foo'], void 0, false);
		assertLocation('{ "foo": {"bar|": 1, "car": 2 } }', ['foo', 'bar'], 'property', true);
		assertLocation('{ "foo": {"bar": 1|, "car": 3 } }', ['foo', 'bar'], 'number', false);
		assertLocation('{ "foo": {"bar": 1,| "car": 4 } }', ['foo', ''], void 0, true);
		assertLocation('{ "foo": {"bar": 1, "ca|r": 5 } }', ['foo', 'car'], 'property', true);
		assertLocation('{ "foo": {"bar": 1, "car": 6| } }', ['foo', 'car'], 'number', false);
		assertLocation('{ "foo": {"bar": 1, "car": 7 }| }', ['foo'], void 0, false);
		assertLocation('{ "foo": {"bar": 1, "car": 8 },| "goo": {} }', [''], void 0, true);
		assertLocation('{ "foo": {"bar": 1, "car": 9 }, "go|o": {} }', ['goo'], 'property', true);
		assertLocation('{ "dep": {"bar": 1, "car": |', ['dep', 'car'], void 0, false);
		assertLocation('{ "dep": {"bar": 1,, "car": |', ['dep', 'car'], void 0, false);
		assertLocation('{ "dep": {"bar": "na", "dar": "ma", "car": | } }', ['dep', 'car'], void 0, false);
	});

	test('location: arrays', () => {
		assertLocation('|["foo", null ]', [], void 0, false);
		assertLocation('[|"foo", null ]', [0], 'string', false);
		assertLocation('["foo"|, null ]', [0], 'string', false);
		assertLocation('["foo",| null ]', [1], void 0, false);
		assertLocation('["foo", |null ]', [1], 'null', false);
		assertLocation('["foo", null,| ]', [2], void 0, false);
		assertLocation('["foo", null,,| ]', [3], void 0, false);
		assertLocation('[["foo", null,, ],|', [1], void 0, false);
	});

	test('tree: literals', () => {
		assertTree('true', { type: 'boolean', offset: 0, length: 4, value: true });
		assertTree('false', { type: 'boolean', offset: 0, length: 5, value: false });
		assertTree('null', { type: 'null', offset: 0, length: 4, value: null });
		assertTree('23', { type: 'number', offset: 0, length: 2, value: 23 });
		assertTree('-1.93e-19', { type: 'number', offset: 0, length: 9, value: -1.93e-19 });
		assertTree('"hello"', { type: 'string', offset: 0, length: 7, value: 'hello' });
	});

	test('tree: arrays', () => {
		assertTree('[]', { type: 'array', offset: 0, length: 2, children: [] });
		assertTree('[ 1 ]', { type: 'array', offset: 0, length: 5, children: [{ type: 'number', offset: 2, length: 1, value: 1 }] });
		assertTree('[ 1,"x"]', {
			type: 'array', offset: 0, length: 8, children: [
				{ type: 'number', offset: 2, length: 1, value: 1 },
				{ type: 'string', offset: 4, length: 3, value: 'x' }
			]
		});
		assertTree('[[]]', {
			type: 'array', offset: 0, length: 4, children: [
				{ type: 'array', offset: 1, length: 2, children: [] }
			]
		});
	});

	test('tree: objects', () => {
		assertTree('{ }', { type: 'object', offset: 0, length: 3, children: [] });
		assertTree('{ "val": 1 }', {
			type: 'object', offset: 0, length: 12, children: [
				{
					type: 'property', offset: 2, length: 8, colonOffset: 7, children: [
						{ type: 'string', offset: 2, length: 5, value: 'val' },
						{ type: 'number', offset: 9, length: 1, value: 1 }
					]
				}
			]
		});
		assertTree('{"id": "$", "v": [ null, null] }',
			{
				type: 'object', offset: 0, length: 32, children: [
					{
						type: 'property', offset: 1, length: 9, colonOffset: 5, children: [
							{ type: 'string', offset: 1, length: 4, value: 'id' },
							{ type: 'string', offset: 7, length: 3, value: '$' }
						]
					},
					{
						type: 'property', offset: 12, length: 18, colonOffset: 15, children: [
							{ type: 'string', offset: 12, length: 3, value: 'v' },
							{
								type: 'array', offset: 17, length: 13, children: [
									{ type: 'null', offset: 19, length: 4, value: null },
									{ type: 'null', offset: 25, length: 4, value: null }
								]
							}
						]
					}
				]
			}
		);
	});

	test('visit: object', () => {
		assertVisit('{ }', [{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 0 }, { id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 2 }]);
		assertVisit('{ "foo": "bar" }', [
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectProperty', text: '"foo"', startLine: 0, startCharacter: 2, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 7, arg: ':' },
			{ id: 'onLiteralValue', text: '"bar"', startLine: 0, startCharacter: 9, arg: 'bar' },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 15 },
		]);
		assertVisit('{ "foo": { "goo": 3 } }', [
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectProperty', text: '"foo"', startLine: 0, startCharacter: 2, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 7, arg: ':' },
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 9 },
			{ id: 'onObjectProperty', text: '"goo"', startLine: 0, startCharacter: 11, arg: 'goo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 16, arg: ':' },
			{ id: 'onLiteralValue', text: '3', startLine: 0, startCharacter: 18, arg: 3 },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 20 },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 22 },
		]);
	});

	test('visit: array', () => {
		assertVisit('[]', [{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 0 }, { id: 'onArrayEnd', text: ']', startLine: 0, startCharacter: 1 }]);
		assertVisit('[ true, null, [] ]', [
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 0 },
			{ id: 'onLiteralValue', text: 'true', startLine: 0, startCharacter: 2, arg: true },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 6, arg: ',' },
			{ id: 'onLiteralValue', text: 'null', startLine: 0, startCharacter: 8, arg: null },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 12, arg: ',' },
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 14 },
			{ id: 'onArrayEnd', text: ']', startLine: 0, startCharacter: 15 },
			{ id: 'onArrayEnd', text: ']', startLine: 0, startCharacter: 17 },
		]);
		assertVisit('[\r\n0,\r\n1,\r\n2\r\n]', [
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 0 },
			{ id: 'onLiteralValue', text: '0', startLine: 1, startCharacter: 0, arg: 0 },
			{ id: 'onSeparator', text: ',', startLine: 1, startCharacter: 1, arg: ',' },
			{ id: 'onLiteralValue', text: '1', startLine: 2, startCharacter: 0, arg: 1 },
			{ id: 'onSeparator', text: ',', startLine: 2, startCharacter: 1, arg: ',' },
			{ id: 'onLiteralValue', text: '2', startLine: 3, startCharacter: 0, arg: 2 },
			{ id: 'onArrayEnd', text: ']', startLine: 4, startCharacter: 0 }]);
	});

	test('visit: incomplete', () => {
		assertVisit('{"prop1":"foo","prop2":"foo2","prop3":{"prp1":{""}}}', [
			{ id: 'onObjectBegin', text: "{", startLine: 0, startCharacter: 0 },
			{ id: 'onObjectProperty', text: '"prop1"', startLine: 0, startCharacter: 1, arg: "prop1" },
			{ id: 'onSeparator', text: ":", startLine: 0, startCharacter: 8, arg: ":" },
			{ id: 'onLiteralValue', text: '"foo"', startLine: 0, startCharacter: 9, arg: "foo" },
			{ id: 'onSeparator', text: ",", startLine: 0, startCharacter: 14, arg: "," },
			{ id: 'onObjectProperty', text: '"prop2"', startLine: 0, startCharacter: 15, arg: "prop2" },
			{ id: 'onSeparator', text: ":", startLine: 0, startCharacter: 22, arg: ":" },
			{ id: 'onLiteralValue', text: '"foo2"', startLine: 0, startCharacter: 23, arg: "foo2" },
			{ id: 'onSeparator', text: ",", startLine: 0, startCharacter: 29, arg: "," },
			{ id: 'onObjectProperty', text: '"prop3"', startLine: 0, startCharacter: 30, arg: "prop3" },
			{ id: 'onSeparator', text: ":", startLine: 0, startCharacter: 37, arg: ":" },
			{ id: 'onObjectBegin', text: "{", startLine: 0, startCharacter: 38 },
			{ id: 'onObjectProperty', text: '"prp1"', startLine: 0, startCharacter: 39, arg: "prp1" },
			{ id: 'onSeparator', text: ":", startLine: 0, startCharacter: 45, arg: ":" },
			{ id: 'onObjectBegin', text: "{", startLine: 0, startCharacter: 46 },
			{ id: 'onObjectProperty', text: '""', startLine: 0, startCharacter: 47, arg: "" },
			{ id: 'onObjectEnd', text: "}", startLine: 0, startCharacter: 49 },
			{ id: 'onObjectEnd', text: "}", startLine: 0, startCharacter: 50 },
			{ id: 'onObjectEnd', text: "}", startLine: 0, startCharacter: 51 }
		], [{ error: ParseErrorCode.ColonExpected, offset: 49, length: 1, startLine: 0, startCharacter: 49 }]);

		assertTree('{"prop1":"foo","prop2":"foo2","prop3":{"prp1":{""}}}', {
			type: 'object', offset: 0, length: 52, children: [
				{
					type: 'property', offset: 1, length: 13, children: [
						{ type: 'string', value: 'prop1', offset: 1, length: 7 },
						{ type: 'string', offset: 9, length: 5, value: 'foo' }
					], colonOffset: 8
				}, {
					type: 'property', offset: 15, length: 14, children: [
						{ type: 'string', value: 'prop2', offset: 15, length: 7 },
						{ type: 'string', offset: 23, length: 6, value: 'foo2' }
					], colonOffset: 22
				},
				{
					type: 'property', offset: 30, length: 21, children: [
						{ type: 'string', value: 'prop3', offset: 30, length: 7 },
						{
							type: 'object', offset: 38, length: 13, children: [
								{
									type: 'property', offset: 39, length: 11, children: [
										{ type: 'string', value: 'prp1', offset: 39, length: 6 },
										{
											type: 'object', offset: 46, length: 4, children: [
												{
													type: 'property', offset: 47, length: 3, children: [
														{ type: 'string', value: '', offset: 47, length: 2 },
													]
												}
											]
										}
									], colonOffset: 45
								}
							]
						}
					], colonOffset: 37
				}
			]
		}, [{ error: ParseErrorCode.ColonExpected, offset: 49, length: 1 }])
	});

	test('tree: find location', () => {
		let root = parseTree('{ "key1": { "key11": [ "val111", "val112" ] }, "key2": [ { "key21": false, "key22": 221 }, null, [{}] ] }');
		assertNodeAtLocation(root, ['key1'], { key11: ['val111', 'val112'] });
		assertNodeAtLocation(root, ['key1', 'key11'], ['val111', 'val112']);
		assertNodeAtLocation(root, ['key1', 'key11', 0], 'val111');
		assertNodeAtLocation(root, ['key1', 'key11', 1], 'val112');
		assertNodeAtLocation(root, ['key1', 'key11', 2], void 0);
		assertNodeAtLocation(root, ['key2', 0, 'key21'], false);
		assertNodeAtLocation(root, ['key2', 0, 'key22'], 221);
		assertNodeAtLocation(root, ['key2', 1], null);
		assertNodeAtLocation(root, ['key2', 2], [{}]);
		assertNodeAtLocation(root, ['key2', 2, 0], {});
	});

	test('location: matches', () => {
		assertMatchesLocation('{ "dependencies": { | } }', ['dependencies']);
		assertMatchesLocation('{ "dependencies": { "fo| } }', ['dependencies']);
		assertMatchesLocation('{ "dependencies": { "fo|" } }', ['dependencies']);
		assertMatchesLocation('{ "dependencies": { "fo|": 1 } }', ['dependencies']);
		assertMatchesLocation('{ "dependencies": { "fo|": 1 } }', ['dependencies']);
		assertMatchesLocation('{ "dependencies": { "fo": | } }', ['dependencies', '*']);
	});


});


suite('JSON5', () => {
	test('comments', () => {
		assertKinds('// this is a comment', SyntaxKind.LineCommentTrivia);
		assertKinds('// this is a comment\n', SyntaxKind.LineCommentTrivia, SyntaxKind.LineBreakTrivia);
		assertKinds('/* this is a comment*/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* this is a \r\ncomment*/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* this is a \ncomment*/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/**/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/***/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/****/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/** */', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* **/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* * */', SyntaxKind.BlockCommentTrivia);

		// unexpected end
		assertScanError('/* this is a', ScanError.UnexpectedEndOfComment, SyntaxKind.BlockCommentTrivia);
		assertScanError('/* this is a \ncomment', ScanError.UnexpectedEndOfComment, SyntaxKind.BlockCommentTrivia);

		// broken comment
		assertKinds('/ ', SyntaxKind.Unknown, SyntaxKind.Trivia);
	});

	test('strings', () => {
		// single quotes
		assertKinds("'test'", SyntaxKind.StringLiteral);
		assertKinds("'\\\"'", SyntaxKind.StringLiteral);
		assertKinds("'\\/'", SyntaxKind.StringLiteral);
		assertKinds("'\\b'", SyntaxKind.StringLiteral);
		assertKinds("'\\f'", SyntaxKind.StringLiteral);
		assertKinds("'\\n'", SyntaxKind.StringLiteral);
		assertKinds("'\\r'", SyntaxKind.StringLiteral);
		assertKinds("'\\t'", SyntaxKind.StringLiteral);
		assertKinds("'\u88ff'", SyntaxKind.StringLiteral);
		assertKinds("'​\u2028'", SyntaxKind.StringLiteral);

		// unbalanced quotes
		assertScanError("'\"", ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral);
		assertScanError("\"'", ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral);

		// multiple lines
		assertKinds('" \\\n "', SyntaxKind.StringLiteral);
		assertKinds("' \\\n '", SyntaxKind.StringLiteral);
		assertKinds('" \\\r "', SyntaxKind.StringLiteral);
		assertKinds("' \\\r '", SyntaxKind.StringLiteral);
		assertKinds('" \u2028 "', SyntaxKind.StringLiteral);
		assertKinds("' \u2028 '", SyntaxKind.StringLiteral);
		assertKinds('" \u2029 "', SyntaxKind.StringLiteral);
		assertKinds("' \u2029 '", SyntaxKind.StringLiteral);
		assertKinds('" \\\r\n "', SyntaxKind.StringLiteral);
		assertKinds("' \\\r\n '", SyntaxKind.StringLiteral);

		// character escapes
		assertKinds("'\\''", SyntaxKind.StringLiteral);
		assertKinds("'\\v'", SyntaxKind.StringLiteral);
		assertKinds("'\\0'", SyntaxKind.StringLiteral);
		assertKinds("'\\ '", SyntaxKind.StringLiteral);

		// additional characters
		assertKinds('"\0 "', SyntaxKind.StringLiteral);
		assertKinds('"\t"', SyntaxKind.StringLiteral);
		assertKinds('"\t "', SyntaxKind.StringLiteral);

		// unexpected end
		assertScanError("'test", ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral);
		assertScanError("'test\n'", ScanError.UnexpectedEndOfString, SyntaxKind.StringLiteral, SyntaxKind.StringLiteral);
	})

	test('numbers', () => {
		// plus sign
		assertKinds('+0', SyntaxKind.NumericLiteral);
		assertKinds('+0.1', SyntaxKind.NumericLiteral);
		assertKinds('+1', SyntaxKind.NumericLiteral);
		assertKinds('+90e-123', SyntaxKind.NumericLiteral);
		assertKinds('+90e+123', SyntaxKind.NumericLiteral);

		// hexadecimal numbers
		assertKinds('0xa', SyntaxKind.NumericLiteral);
		assertKinds('0Xdecaf', SyntaxKind.NumericLiteral);
		assertKinds('-0xC0FFEE', SyntaxKind.NumericLiteral);
		assertKinds('0x0', SyntaxKind.NumericLiteral);

		// leading or trailing decimal point
		assertKinds('.0', SyntaxKind.NumericLiteral);
		assertKinds('.90E+123', SyntaxKind.NumericLiteral);
		assertKinds('-.1', SyntaxKind.NumericLiteral);
		assertKinds('+.0', SyntaxKind.NumericLiteral);
		assertKinds('+.90e-123', SyntaxKind.NumericLiteral);
		assertKinds('-90.E+123', SyntaxKind.NumericLiteral);
		assertKinds('0.', SyntaxKind.NumericLiteral);
		assertKinds('-1.', SyntaxKind.NumericLiteral);
		assertKinds('123456789.', SyntaxKind.NumericLiteral);
		assertKinds('+1.', SyntaxKind.NumericLiteral);

		// Infinity and NaN
		assertKinds('Infinity', SyntaxKind.InfinityKeyword);
		assertKinds('-Infinity', SyntaxKind.NumericLiteral);
		assertKinds('+Infinity', SyntaxKind.NumericLiteral);
		assertKinds('NaN', SyntaxKind.NaNKeyword);
		assertKinds('-NaN', SyntaxKind.NumericLiteral);
		assertKinds('+NaN', SyntaxKind.NumericLiteral);

		// unexpected end
		assertKinds('+', SyntaxKind.Unknown);
		assertKinds('.', SyntaxKind.Unknown);

		// multiple signs
		assertKinds('+-1', SyntaxKind.Unknown, SyntaxKind.NumericLiteral);
		assertKinds('-+1', SyntaxKind.Unknown, SyntaxKind.NumericLiteral);
		assertKinds('--1', SyntaxKind.Unknown, SyntaxKind.NumericLiteral);
		assertKinds('++1', SyntaxKind.Unknown, SyntaxKind.NumericLiteral);

		// invalid hex
		assertKinds('.0x1', SyntaxKind.NumericLiteral, SyntaxKind.Identifier);
		assertKinds('-0x', SyntaxKind.NumericLiteral, SyntaxKind.Identifier);
		assertKinds('-0XG', SyntaxKind.NumericLiteral, SyntaxKind.Identifier);
		assertKinds('0xfff.', SyntaxKind.NumericLiteral, SyntaxKind.Unknown);

		// extra decimal
		assertKinds('.1.', SyntaxKind.NumericLiteral, SyntaxKind.Unknown);
	});

	test('identifiers', () => {
		assertKinds('a', SyntaxKind.Identifier);
		assertKinds('ab', SyntaxKind.Identifier);
		assertKinds('nulllll', SyntaxKind.Identifier);
		assertKinds('True', SyntaxKind.Identifier);
		assertKinds('truefalse', SyntaxKind.Identifier);
		assertKinds('$100', SyntaxKind.Identifier);
		assertKinds('$100', SyntaxKind.Identifier);
		assertKinds('\\u1234', SyntaxKind.Identifier);
		assertKinds('ஐᚙዎဪᔽᆶഐᚠ', SyntaxKind.Identifier);

		assertKinds('foo-bar', SyntaxKind.Identifier, SyntaxKind.Unknown, SyntaxKind.Identifier);
		assertKinds('foo bar', SyntaxKind.Identifier, SyntaxKind.Trivia, SyntaxKind.Identifier);
		assertKinds('/ ttt', SyntaxKind.Unknown, SyntaxKind.Trivia, SyntaxKind.Identifier);
	});

	test('trivia', () => {
		assertKinds('\u000B', SyntaxKind.Trivia);
		assertKinds('\u000C', SyntaxKind.Trivia);
		assertKinds('\u00A0', SyntaxKind.Trivia);
		assertKinds('\uFEFF', SyntaxKind.Trivia);
		assertKinds('\u2006', SyntaxKind.Trivia);
		assertKinds(' \t\u000B\u000C\u00A0\uFEFF\u2006', SyntaxKind.Trivia);

		assertKinds('\u2028', SyntaxKind.LineBreakTrivia);
		assertKinds('\u2029', SyntaxKind.LineBreakTrivia);
		assertKinds(
			'\t\u000B\u000C\u00A0\uFEFF\u2006 \n\r\u2028\u2029 \t\u000B\u000C\u00A0\uFEFF\u2006',
			SyntaxKind.Trivia,
			SyntaxKind.LineBreakTrivia,
			SyntaxKind.LineBreakTrivia,
			SyntaxKind.LineBreakTrivia,
			SyntaxKind.LineBreakTrivia,
			SyntaxKind.Trivia
		);
	});

	test('parse: literals', () => {
		assertValidParse("'foo'", 'foo');
		assertValidParse('"a\\\nb"', 'ab');
		assertValidParse("'a\\\nb'", 'ab');
		assertValidParse('+9', 9);
		assertValidParse('-0', -0);
		assertValidParse('Infinity', Infinity);
		assertValidParse('-Infinity', -Infinity);
		assertValidParse('+Infinity', +Infinity);
		assertValidParse('NaN', NaN);
		assertValidParse('-NaN', -NaN);
		assertValidParse('+NaN', +NaN);
		assertValidParse('.1E-999 /* comment */', .1E-999);
		assertValidParse('1.2E-3 // comment', 1.2E-3);
	});

	test('parse: objects', () => {
		assertValidParse("{'b': {}}", { b: {} });
		assertValidParse("{'': ''}", { '': '' });
		assertValidParse("{'\"': '\"'}", { '"': '"' });
		assertValidParse('{"\'\'": "\'\'"}', { "''": "''" });
		assertValidParse('{ "foo": /*hello*/true }', { foo: true });

		// unquoted property names
		assertValidParse('{a: true}', { a: true });
		assertValidParse("{a: \"a\", 'b': 'b', \"c\": 'c'}", { a: 'a', b: 'b', c: 'c' });
		assertValidParse('{true: true}', { true: true });
		assertValidParse('{NaN: Infinity, Infinity: "NaN"}', { NaN: Infinity, Infinity: 'NaN' });
		assertValidParse('{nulllll: true}', { nulllll: true });
		assertValidParse('{ ₐ: "A"}', { ₐ: 'A' });

		// numbers are still not allowed unquoted
		assertInvalidParse('{ 1: "one" }', {});
		assertInvalidParse('{ +Infinity: "wut" }', {});

		// trailing commas
		assertValidParse('{ "hello": [], }', { hello: [] });
		assertValidParse('{ "hello": [] }', { hello: [] });
		assertValidParse('{ "hello": [], "world": {}, }', { hello: [], world: {} });
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} });
		assertValidParse('{ "foo": true, }', { foo: true });
		assertValidParse('{"a": "b",}', { a: 'b' });
		assertValidParse('{c: 1,}', { c: 1 });
		assertValidParse('{_: [{},],}', { _: [{}] });
		assertValidParse('{ comma: ",", }', { comma: ',' });
		assertValidParse('{x:{x:{x:{},},},}', { x: { x: { x: {} } } });
		assertValidParse('{",":",",}', { ',': ',' });

		assertInvalidParse('{ a: true,, }', { a: true });
		assertInvalidParse('{ a: true,, b: false }', { a: true, b: false });
		assertInvalidParse('{ , a: true, b: false }', { a: true, b: false });
		assertInvalidParse('{,}', {});
	});

	test('parse: arrays', () => {
		assertValidParse('[ 1, 2, ]', [1, 2]);
		assertValidParse('[ [],  [ [], ],]', [[], [[]]]);
		assertValidParse('[ { "a": null, }, ]', [{ a: null }]);

		assertInvalidParse('[1,,]', [1]);
		assertInvalidParse('[1,,2]', [1, 2]);
		assertInvalidParse('[,1,2]', [1, 2]);
		assertInvalidParse('[,]', []);
	});

	test('location: properties', () => {
		assertLocation("|{ foo: 'bar', }", [], void 0, false);
		assertLocation("{| foo: 'bar', }", [''], void 0, true);
		assertLocation("{ |foo: 'bar', }", ['foo'], 'property', true);
		assertLocation("{ foo|: 'bar', }", ['foo'], 'property', true);
		assertLocation("{ foo|: 'bar', }", ['foo'], 'property', true);
		assertLocation("{ foo: 'bar'|, }", ['foo'], 'string', false);
		assertLocation("{ foo: 'bar',| }", [''], void 0, true);
		assertLocation("{ foo:| 'bar', }", ['foo'], void 0, false);
		assertLocation('{ foo: {\'bar|\': NaN, "car": +0x1 /* blah */ } }', ['foo', 'bar'], 'property', true);
		assertLocation('{ foo: {\'bar\': N|aN, "car": -0x2 /* blah */ } }', ['foo', 'bar'], 'number', false);
		assertLocation('{ foo: {\'bar\': NaN|, "car": +0x3 /* blah */ } }', ['foo', 'bar'], 'number', false);
		assertLocation('{ foo: {\'bar\': NaN,| "car": -0x4 /* blah */ } }', ['foo', ''], void 0, true);
		assertLocation('{ foo: {\'bar\': NaN, "ca|r": +0x5 /* blah */ } }', ['foo', 'car'], 'property', true);
		assertLocation('{ foo: {\'bar\': NaN, "car": -|0x6 /* blah */ } }', ['foo', 'car'], 'number', false);
		assertLocation('{ foo: {\'bar\': NaN, "car": +0x7| /* blah */ } }', ['foo', 'car'], 'number', false);
		assertLocation('{ foo: {\'bar\': NaN, "car": -0x8 /* blah| */ } }', ['foo', 'car'], 'number', false);
		assertLocation('{ foo: {\'bar\': NaN, "car": +0x9 /* blah */ }| }', ['foo'], void 0, false);
		assertLocation('{ foo: {\'bar\': NaN, "car": -0xa /* blah */ },| "\\u1234": {} }', [''], void 0, true);
		assertLocation('{ foo: {\'bar\': NaN, "car": +0xB /* blah */ }, "\\u12|34": {} }', ['\u1234'], 'property', true);
	});

	test('location: arrays', () => {
		assertLocation("|['foo', 0x0 ]", [], void 0, false);
		assertLocation("[|'foo', 0x0 ]", [0], 'string', false);
		assertLocation("['foo'|, 0x0 ]", [0], 'string', false);
		assertLocation("['foo',| 0x0 ]", [1], void 0, false);
		assertLocation("['foo', |0x0 ]", [1], 'number', false);
		assertLocation("['foo', 0x0,| ]", [2], void 0, false);
		assertLocation("['foo', 0x0,,| ]", [3], void 0, false);
		assertLocation("[['foo', 0x0,, ],|", [1], void 0, false);
	});

	test('location: matches', () => {
		assertMatchesLocation('{ dependencies: { | } }', ['dependencies']);
		assertMatchesLocation('{ dependencies: { fo| } }', ['dependencies']);
		assertMatchesLocation('{ dependencies: { fo| } }', ['dependencies']);
		assertMatchesLocation('{ dependencies: { fo|: 1 } }', ['dependencies']);
		assertMatchesLocation('{ dependencies: { fo|: 1 } }', ['dependencies']);
		assertMatchesLocation('{ dependencies: { fo: | } }', ['dependencies', '*']);
	});

	test('tree: literals', () => {
		assertTree('Infinity', { type: 'number', offset: 0, length: 8, value: Infinity });
		assertTree('+Infinity', { type: 'number', offset: 0, length: 9, value: Infinity });
		assertTree('-Infinity', { type: 'number', offset: 0, length: 9, value: -Infinity });
		assertTree('0X3', { type: 'number', offset: 0, length: 3, value: 3 });
		assertTree('-0x0123456789abcdefABCDEF', {
			type: 'number',
			offset: 0,
			length: 25,
			value: -0x0123456789abcdefabcdef
		});
		assertTree('+1.93e-19', { type: 'number', offset: 0, length: 9, value: +1.93e-19 });
		assertTree("'hello'", { type: 'string', offset: 0, length: 7, value: 'hello' });
	});

	test('tree: arrays', () => {
		assertTree('[ 1, ]', {
			type: 'array',
			offset: 0,
			length: 6,
			children: [{ type: 'number', offset: 2, length: 1, value: 1 }]
		});
		assertTree('[[[],[],],]', {
			type: 'array',
			offset: 0,
			length: 11,
			children: [
				{
					type: 'array',
					offset: 1,
					length: 8,
					children: [
						{ type: 'array', offset: 2, length: 2, children: [] },
						{ type: 'array', offset: 5, length: 2, children: [] }
					]
				}
			]
		});
	});

	test('tree: objects', () => {
		assertTree('{  "id": { "foo": { } } , }', {
			type: 'object',
			offset: 0,
			length: 27,
			children: [
				{
					type: 'property',
					offset: 3,
					length: 20,
					colonOffset: 7,
					children: [
						{ type: 'string', offset: 3, length: 4, value: 'id' },
						{
							type: 'object',
							offset: 9,
							length: 14,
							children: [
								{
									type: 'property',
									offset: 11,
									length: 10,
									colonOffset: 16,
									children: [
										{ type: 'string', offset: 11, length: 5, value: 'foo' },
										{ type: 'object', offset: 18, length: 3, children: [] }
									]
								}
							]
						}
					]
				}
			]
		});

		assertTree(
			'{  "id": { "foo": { } } ,, }',
			{
				type: 'object',
				offset: 0,
				length: 28,
				children: [
					{
						type: 'property',
						offset: 3,
						length: 20,
						colonOffset: 7,
						children: [
							{ type: 'string', offset: 3, length: 4, value: 'id' },
							{
								type: 'object',
								offset: 9,
								length: 14,
								children: [
									{
										type: 'property',
										offset: 11,
										length: 10,
										colonOffset: 16,
										children: [
											{ type: 'string', offset: 11, length: 5, value: 'foo' },
											{ type: 'object', offset: 18, length: 3, children: [] }
										]
									}
								]
							}
						]
					}
				]
			},
			[
				{ error: ParseErrorCode.PropertyNameExpected, offset: 25, length: 1 },
				{ error: ParseErrorCode.ValueExpected, offset: 25, length: 1 }
			]
		);

		assertTree('{$:{},}', {
			type: 'object',
			offset: 0,
			length: 7,
			children: [
				{
					type: 'property',
					offset: 1,
					length: 4,
					colonOffset: 2,
					children: [
						{ type: 'string', offset: 1, length: 1, value: '$' },
						{ type: 'object', offset: 3, length: 2, children: [] }
					]
				}
			]
		});
		assertTree('{ val: 1 }', {
			type: 'object',
			offset: 0,
			length: 10,
			children: [
				{
					type: 'property',
					offset: 2,
					length: 6,
					colonOffset: 5,
					children: [
						{ type: 'string', offset: 2, length: 3, value: 'val' },
						{ type: 'number', offset: 7, length: 1, value: 1 }
					]
				}
			]
		});
	});

	test('tree: find location', () => {
		let root = parseTree('{ key1: { key11: [ \'val111\', "val112", ], }, \'key2\': [ { null: Infinity, "key22": 221, }, NaN, [{}] ] }');
		assertNodeAtLocation(root, ['key1'], { key11: ['val111', 'val112'] });
		assertNodeAtLocation(root, ['key1', 'key11'], ['val111', 'val112']);
		assertNodeAtLocation(root, ['key1', 'key11', 0], 'val111');
		assertNodeAtLocation(root, ['key1', 'key11', 1], 'val112');
		assertNodeAtLocation(root, ['key1', 'key11', 2], void 0);
		assertNodeAtLocation(root, ['key2', 0, 'null'], Infinity);
		assertNodeAtLocation(root, ['key2', 0, 'key22'], 221);
		assertNodeAtLocation(root, ['key2', 1], NaN);
		assertNodeAtLocation(root, ['key2', 2], [{}]);
		assertNodeAtLocation(root, ['key2', 2, 0], {});
	});

	test('visit: comment', () => {
		assertVisit('/* g */ { "foo": //f\n"bar" }', [
			{ id: 'onComment', text: '/* g */', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 8 },
			{ id: 'onObjectProperty', text: '"foo"', startLine: 0, startCharacter: 10, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 15, arg: ':' },
			{ id: 'onComment', text: '//f', startLine: 0, startCharacter: 17 },
			{ id: 'onLiteralValue', text: '"bar"', startLine: 1, startCharacter: 0, arg: 'bar' },
			{ id: 'onObjectEnd', text: '}', startLine: 1, startCharacter: 6 },
		]);
		assertVisit('/* g\r\n */ { "foo": //f\n"bar" }', [
			{ id: 'onComment', text: '/* g\r\n */', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectBegin', text: '{', startLine: 1, startCharacter: 4 },
			{ id: 'onObjectProperty', text: '"foo"', startLine: 1, startCharacter: 6, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 1, startCharacter: 11, arg: ':' },
			{ id: 'onComment', text: '//f', startLine: 1, startCharacter: 13 },
			{ id: 'onLiteralValue', text: '"bar"', startLine: 2, startCharacter: 0, arg: 'bar' },
			{ id: 'onObjectEnd', text: '}', startLine: 2, startCharacter: 6 },
		]);
		assertVisit('/* g\n */ { "foo": //f\n"bar"\n}',
			[
				{ id: 'onObjectBegin', text: '{', startLine: 1, startCharacter: 4 },
				{ id: 'onObjectProperty', text: '"foo"', startLine: 1, startCharacter: 6, arg: 'foo' },
				{ id: 'onSeparator', text: ':', startLine: 1, startCharacter: 11, arg: ':' },
				{ id: 'onLiteralValue', text: '"bar"', startLine: 2, startCharacter: 0, arg: 'bar' },
				{ id: 'onObjectEnd', text: '}', startLine: 3, startCharacter: 0 },
			],
			[
				{ error: ParseErrorCode.InvalidCommentToken, offset: 0, length: 8, startLine: 0, startCharacter: 0 },
				{ error: ParseErrorCode.InvalidCommentToken, offset: 18, length: 3, startLine: 1, startCharacter: 13 },
			],
			true);
	});

	test('visit: object', () => {
		assertVisit("{ foo: 'bar' }", [
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectProperty', text: 'foo', startLine: 0, startCharacter: 2, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 5, arg: ':' },
			{ id: 'onLiteralValue', text: "'bar'", startLine: 0, startCharacter: 7, arg: 'bar' },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 13 }
		]);

		assertVisit("{ foo: { 'goo': Infinity, }, }", [
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 0 },
			{ id: 'onObjectProperty', text: 'foo', startLine: 0, startCharacter: 2, arg: 'foo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 5, arg: ':' },
			{ id: 'onObjectBegin', text: '{', startLine: 0, startCharacter: 7 },
			{ id: 'onObjectProperty', text: "'goo'", startLine: 0, startCharacter: 9, arg: 'goo' },
			{ id: 'onSeparator', text: ':', startLine: 0, startCharacter: 14, arg: ':' },
			{ id: 'onLiteralValue', text: 'Infinity', startLine: 0, startCharacter: 16, arg: Infinity },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 24, arg: ',' },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 26 },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 27, arg: ',' },
			{ id: 'onObjectEnd', text: '}', startLine: 0, startCharacter: 29 }
		]);
	});

	test('visit: array', () => {
		assertVisit("[ 'hi', +1, [], ]", [
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 0 },
			{ id: 'onLiteralValue', text: "'hi'", startLine: 0, startCharacter: 2, arg: 'hi' },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 6, arg: ',' },
			{ id: 'onLiteralValue', text: '+1', startLine: 0, startCharacter: 8, arg: 1 },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 10, arg: ',' },
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 12 },
			{ id: 'onArrayEnd', text: ']', startLine: 0, startCharacter: 13 },
			{ id: 'onSeparator', text: ',', startLine: 0, startCharacter: 14, arg: ',' },
			{ id: 'onArrayEnd', text: ']', startLine: 0, startCharacter: 16 }
		]);

		assertVisit('[\r0,\n1,\u{2028}2\u{2029}]', [
			{ id: 'onArrayBegin', text: '[', startLine: 0, startCharacter: 0 },
			{ id: 'onLiteralValue', text: '0', startLine: 1, startCharacter: 0, arg: 0 },
			{ id: 'onSeparator', text: ',', startLine: 1, startCharacter: 1, arg: ',' },
			{ id: 'onLiteralValue', text: '1', startLine: 2, startCharacter: 0, arg: 1 },
			{ id: 'onSeparator', text: ',', startLine: 2, startCharacter: 1, arg: ',' },
			{ id: 'onLiteralValue', text: '2', startLine: 3, startCharacter: 0, arg: 2 },
			{ id: 'onArrayEnd', text: ']', startLine: 4, startCharacter: 0 }
		]);
	});
})
