import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";

import { createStandaloneMcpRequestContext, runWithRequestContext } from "../request-context.js";
import { findWorkspaceRoot, resolvePathInsideContext } from "./client-wrapper.js";
import { LspInvalidPathError } from "./errors.js";

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function tempRoot(prefix: string): string {
	const root = mkdtempSync(join(tmpdir(), prefix));
	tempDirectories.push(root);
	return root;
}

describe("LSP client path confinement", () => {
	it("#given a relative file inside context cwd #when resolving workspace #then marker search stays inside cwd", () => {
		const root = tempRoot("lsp-client-wrapper-root-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, "src", "file.ts"), "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("src/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given a marker above context cwd #when resolving workspace #then marker search does not escape cwd", () => {
		const parent = tempRoot("lsp-client-wrapper-parent-");
		const root = join(parent, "project");
		mkdirSync(join(parent, ".git"), { recursive: true });
		mkdirSync(root, { recursive: true });
		writeFileSync(join(root, "file.ts"), "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given an absolute file outside context cwd #when resolving #then allows and picks nearest marker", () => {
		const root = tempRoot("lsp-client-wrapper-cwd-");
		const outside = tempRoot("lsp-client-wrapper-outside-");
		mkdirSync(join(outside, ".git"), { recursive: true });
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot(join(outside, "file.ts")),
		);

		expect(workspace).toBe(realpathSync(outside));
	});

	it("#given a directory named like a parent escape inside cwd #when resolving #then treats it as inside", () => {
		const root = tempRoot("lsp-client-wrapper-dotdot-");
		mkdirSync(join(root, ".git"), { recursive: true });
		mkdirSync(join(root, "..cache"), { recursive: true });
		writeFileSync(join(root, "..cache", "file.ts"), "export const cached = true;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("..cache/file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given a markerless directory inside markerless cwd #when resolving workspace #then falls back to the directory itself", () => {
		const root = tempRoot("lsp-client-wrapper-markerless-");
		const plain = join(root, "plain");
		mkdirSync(plain, { recursive: true });

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot(plain),
		);

		expect(workspace).toBe(realpathSync(plain));
	});

	it("#given a markerless file inside markerless cwd #when resolving workspace #then falls back to its parent directory", () => {
		const root = tempRoot("lsp-client-wrapper-markerless-");
		writeFileSync(join(root, "file.ts"), "export const value = 1;\n");

		const workspace = runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
			findWorkspaceRoot("file.ts"),
		);

		expect(workspace).toBe(realpathSync(root));
	});

	it("#given a symlink inside cwd that points outside #when resolving #then rejects the escape", () => {
		const root = tempRoot("lsp-client-wrapper-symlink-root-");
		const outside = tempRoot("lsp-client-wrapper-symlink-outside-");
		writeFileSync(join(outside, "file.ts"), "export const outside = true;\n");
		symlinkSync(outside, join(root, "linked"));

		expect(() =>
			runWithRequestContext(createStandaloneMcpRequestContext({ cwd: root }), () =>
				resolvePathInsideContext("linked/file.ts"),
			),
		).toThrow(LspInvalidPathError);
	});
});
