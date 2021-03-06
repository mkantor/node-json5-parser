/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { ScanError, SyntaxKind, JSON5Scanner } from '../main';
import { ScanResult, isFailure, json5InputElement } from './grammar';

/**
 * Creates a JSON5 scanner on the given text.
 * If ignoreTrivia is set, whitespaces or comments are ignored.
 */
export function createScanner(text: string, ignoreTrivia: boolean = false): JSON5Scanner {

	type ScanState = {
		token: SyntaxKind;
		value: string;
		scanError: ScanError;
		pos: number;
		lineNumber: number;
		tokenLineStartOffset: number;
		tokenOffset: number;
		lineStartOffset: number;
		prevTokenLineStartOffset: number;
	}

	const len = text.length;
	let state: ScanState = {
		pos: 0,
		value: '',
		tokenOffset: 0,
		token: SyntaxKind.Unknown,
		lineNumber: 0,
		lineStartOffset: 0,
		tokenLineStartOffset: 0,
		prevTokenLineStartOffset: 0,
		scanError: ScanError.None
	};

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

	function computeNextScanState(text: string, previousState: ScanState, scanResult: ScanResult): ScanState {
		const pos = previousState.pos + scanResult.length;
		const value = text.substring(previousState.pos, pos);

		const baseState: ScanState = {
			...previousState,
			pos,
			token: scanResult.syntaxKind,
			lineNumber: previousState.lineNumber + scanResult.lineBreaksCount,
			tokenLineStartOffset:
				scanResult.lineBreaksCount > 0
					? previousState.pos + scanResult.lengthToEndOfLastLineBreak
					: previousState.tokenLineStartOffset
		};
		return isFailure(scanResult)
			? {
					...baseState,
					pos: baseState.pos + 1,
					value: baseState.value + text[pos],
					...errorAttributesMap[scanResult.syntaxKind]
			  }
			: {
					...baseState,
					value
			  };
	}

	function setPosition(newPosition: number): void {
		state.pos = newPosition;
		state.value = '';
		state.tokenOffset = 0;
		state.token = SyntaxKind.Unknown;
		state.scanError = ScanError.None;
	}

	function scanNext(): SyntaxKind {
		const baseState: ScanState = {
			...state,
			value: '',
			scanError: ScanError.None,
			tokenOffset: state.pos,
			lineStartOffset: state.lineNumber,
			prevTokenLineStartOffset: state.tokenLineStartOffset
		};
		if (state.pos >= len) {
			// at the end
			state = {
				...baseState,
				tokenOffset: len,
				token: SyntaxKind.EOF
			};
		} else {
			const scanResult = json5InputElement(text.substring(state.pos));
			state = computeNextScanState(text, baseState, scanResult);
		}
		return state.token;
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
		getPosition: () => state.pos,
		scan: ignoreTrivia ? scanNextNonTrivia : scanNext,
		getToken: () => state.token,
		getTokenValue: () => state.value,
		getTokenOffset: () => state.tokenOffset,
		getTokenLength: () => state.pos - state.tokenOffset,
		getTokenStartLine: () => state.lineStartOffset,
		getTokenStartCharacter: () => state.tokenOffset - state.prevTokenLineStartOffset,
		getTokenError: () => state.scanError
	};
}
