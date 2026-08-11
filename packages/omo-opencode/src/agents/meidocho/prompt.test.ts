/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { AvailableAgent } from "../dynamic-agent-prompt-builder";
import { buildMeidochoPrompt, defaultMeidochoTemplate } from "./prompt";
import { validateMeidochoTemplate } from "./template";

const AVAILABLE_AGENTS: AvailableAgent[] = [
	{
		name: "explore",
		description: "Contextual grep for codebases.",
		metadata: {
			category: "exploration",
			cost: "FREE",
			triggers: [{ domain: "Codebase discovery", trigger: "Find local patterns" }],
		},
	},
	{
		name: "librarian",
		description: "External documentation and open-source research.",
		metadata: {
			category: "exploration",
			cost: "CHEAP",
			triggers: [{ domain: "External references", trigger: "Find official docs" }],
		},
	},
	{
		name: "oracle",
		description: "Read-only architecture and debugging consultant.",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			triggers: [{ domain: "Architecture review", trigger: "Resolve tradeoffs" }],
		},
	},
	{
		name: "momus",
		description: "Plan quality reviewer.",
		metadata: {
			category: "advisor",
			cost: "EXPENSIVE",
			triggers: [{ domain: "Plan audit", trigger: "Review plans" }],
		},
	},
];

function extractDelegationAgentNames(prompt: string): Set<string> {
	const tableRows = prompt.match(
		/### Delegation Table:\n\n(?<rows>(?:- .+\n?)*)/,
	)?.groups?.rows;
	return new Set(
		[...(tableRows ?? "").matchAll(/→ `(?<agent>[^`]+)`/g)].flatMap(
			(match) => (match.groups?.agent ? [match.groups.agent] : []),
		),
	);
}

describe("Meidocho generated prompt", () => {
	test("renders only direct research delegation agents", () => {
		// given: direct agents and a planning reviewer are available
		const prompt = buildMeidochoPrompt(AVAILABLE_AGENTS, [], [], [], false);

		// then: the delegation table contains only the direct-agent allowlist
		expect(extractDelegationAgentNames(prompt)).toEqual(
			new Set(["explore", "librarian", "oracle"]),
		);
	});

	test("uses the role description as the identity sentence", () => {
		// when: the generic Meidocho prompt is rendered
		const prompt = buildMeidochoPrompt();

		// then: the role keeps the code name without making it the injected identity
		expect(prompt).toContain("你是主人的女仆长兼私人开发姬，代号Meidocho。");
		expect(prompt).not.toContain("你是 Meidocho，主人的女仆长兼私人开发姬。");
	});

	test("uses the OK-to-go invitation when intent is ambiguous", () => {
		// when: the generic Meidocho prompt is rendered
		const prompt = buildMeidochoPrompt();

		// then: the action rule uses the exact ambiguity fallback
		expect(prompt).toContain(
			"实现，不要仅提议/分析。除非主人明确在提问、头脑风暴或要求计划，否则他们要的是能跑的代码，不是描述。消息意味着行动：\"X 是怎么工作的\"意味着理解 X 以修复或改进它；\"为什么 A 坏了\"意味着诊断并修复 A。通常只有当主人明确说\"只解释\"、\"别改任何东西\"时才视为纯回答；实在无法确认是解释还是行动：一个「OK-to-go」的邀请——「说一声OK我就开干哦~」",
		);
	});

	test("bundled default template passes the four validation rules", () => {
		// when: the git-tracked default template is validated
		const result = validateMeidochoTemplate(defaultMeidochoTemplate());

		// then: all six required slots appear exactly once
		expect(result.ok).toBe(true);
	});

	test("renders a user-provided template with slot markers in custom positions", () => {
		// given: a private template that moves two slots to the top
		const custom = [
			"{{ delegationTable }}",
			"自定义开头",
			"{{ taskSystemGuide }}",
			"{{ categorySkillsGuide }}",
			"{{ oracleSection:omit }}",
			"{{ frontendGuidance }}",
			"{{ fileEditGuidance }}",
		].join("\n");

		// when: rendered through the pipeline
		const prompt = buildMeidochoPrompt(AVAILABLE_AGENTS, [], [], [], false, undefined, custom);

		// then: the delegation table leads, the omitted section is gone
		expect(prompt.startsWith("### Delegation Table:")).toBe(true);
		expect(prompt).toContain("自定义开头");
		expect(prompt).not.toContain("Oracle - Read-Only High-IQ Consultant");
	});
});
