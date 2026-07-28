import fs from "node:fs";
import path from "node:path";

import type {
  ArtifactType,
  RawAgentResponse
} from "../shared/types.js";
import { answerInDemoMode } from "../server/demo.js";

interface EvalCase {
  id: string;
  prompt: string;
  mode: RawAgentResponse["mode"];
  answerIncludes?: string[];
  answerExcludes?: string[];
  citationPages?: number[];
  artifactTypes?: ArtifactType[];
}

interface EvalResult {
  id: string;
  passed: boolean;
  failures: string[];
}

const root = process.cwd();
const cases = JSON.parse(
  fs.readFileSync(path.join(root, "evals", "cases.json"), "utf8")
) as EvalCase[];

function evaluate(testCase: EvalCase): EvalResult {
  const response = answerInDemoMode({ message: testCase.prompt });
  const answer = response.answer.toLowerCase();
  const failures: string[] = [];

  if (response.mode !== testCase.mode) {
    failures.push(`expected mode ${testCase.mode}, received ${response.mode}`);
  }

  for (const phrase of testCase.answerIncludes ?? []) {
    if (!answer.includes(phrase.toLowerCase())) {
      failures.push(`missing answer phrase "${phrase}"`);
    }
  }

  for (const phrase of testCase.answerExcludes ?? []) {
    if (answer.includes(phrase.toLowerCase())) {
      failures.push(`unexpected answer phrase "${phrase}"`);
    }
  }

  const pages = new Set(response.citations.map((citation) => citation.page));
  for (const page of testCase.citationPages ?? []) {
    if (!pages.has(page)) failures.push(`missing citation page ${page}`);
  }

  const artifacts = new Set(
    response.artifacts.map((artifact) => artifact.type)
  );
  for (const type of testCase.artifactTypes ?? []) {
    if (!artifacts.has(type)) failures.push(`missing ${type} artifact`);
  }

  if (
    (testCase.artifactTypes?.length ?? 0) === 0 &&
    response.artifacts.length > 0
  ) {
    failures.push("expected no artifact");
  }

  return {
    id: testCase.id,
    passed: failures.length === 0,
    failures
  };
}

const results = cases.map(evaluate);
const passed = results.filter((result) => result.passed).length;

console.log("\nOmniGuide deterministic evaluation");
console.log("==================================");
for (const result of results) {
  console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.id}`);
  for (const failure of result.failures) {
    console.log(`      ${failure}`);
  }
}
console.log("----------------------------------");
console.log(`${passed}/${results.length} cases passed\n`);

if (passed !== results.length) {
  process.exitCode = 1;
}
