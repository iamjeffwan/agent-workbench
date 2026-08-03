const EXPLORATION_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'SemanticSearch',
  'WebSearch',
  'WebFetch',
  'rg',
]);

/**
 * Score agent-steps + program records against a scenario expectation.
 * Returns stable metric names for before/after diffs.
 */
export function scoreArtifacts({ agentSteps, programRecords, expect = {} }) {
  const failures = [];
  const agents = agentSteps.filter((step) => !step.parseError && step.id);
  const programs = programRecords.filter((record) => !record.parseError);

  const agentIds = new Set(agents.map((step) => step.id));
  const linked = programs.filter((record) =>
    agentIds.has(record.processOriginId),
  );
  const linkRate =
    programs.length === 0 ? 1 : linked.length / programs.length;

  const exploreCount = agents.filter((step) =>
    EXPLORATION_TOOLS.has(step.name),
  ).length;
  const exploreNoiseRatio =
    agents.length === 0 ? 0 : exploreCount / agents.length;

  const incomplete = programs.filter((record) => record.incomplete).length;
  const incompleteRate =
    programs.length === 0 ? 0 : incomplete / programs.length;

  // Silent drop is a red-line metric. For file artifacts we approximate:
  // parse errors in JSONL count as silent corruption / loss.
  const parseErrors =
    agentSteps.filter((step) => step.parseError).length +
    programRecords.filter((record) => record.parseError).length;
  const silentDrop = parseErrors > 0;

  let parentChildAccuracy = 1;
  const parentEdges = expect.parent_edges || [];
  if (parentEdges.length > 0) {
    let ok = 0;
    for (const edge of parentEdges) {
      const hit = programs.find(
        (record) =>
          record.callId === edge.callId &&
          record.parentCallId === edge.parentCallId,
      );
      if (hit) ok += 1;
      else {
        failures.push({
          type: 'parent_edge_missing',
          expected: edge,
        });
      }
    }
    parentChildAccuracy = ok / parentEdges.length;
  }

  for (const link of expect.links || []) {
    const matched = programs.filter(
      (record) => record.processOriginId === link.origin,
    );
    const methodIds = new Set(matched.map((record) => record.methodId));
    for (const methodId of link.methodIds || []) {
      if (!methodIds.has(methodId)) {
        failures.push({
          type: 'link_method_missing',
          origin: link.origin,
          methodId,
        });
      }
    }
    if (typeof link.minCalls === 'number' && matched.length < link.minCalls) {
      failures.push({
        type: 'link_min_calls',
        origin: link.origin,
        expected: link.minCalls,
        actual: matched.length,
      });
    }
  }

  if (
    typeof expect.min_program_records === 'number' &&
    programs.length < expect.min_program_records
  ) {
    failures.push({
      type: 'min_program_records',
      expected: expect.min_program_records,
      actual: programs.length,
    });
  }

  if (
    typeof expect.min_agent_tools === 'number' &&
    agents.length < expect.min_agent_tools
  ) {
    failures.push({
      type: 'min_agent_tools',
      expected: expect.min_agent_tools,
      actual: agents.length,
    });
  }

  if (
    typeof expect.max_explore_noise_ratio === 'number' &&
    exploreNoiseRatio > expect.max_explore_noise_ratio
  ) {
    failures.push({
      type: 'explore_noise_too_high',
      expected_max: expect.max_explore_noise_ratio,
      actual: exploreNoiseRatio,
    });
  }

  if (
    typeof expect.min_explore_noise_ratio === 'number' &&
    exploreNoiseRatio + 1e-9 < expect.min_explore_noise_ratio
  ) {
    failures.push({
      type: 'explore_noise_too_low',
      expected_min: expect.min_explore_noise_ratio,
      actual: exploreNoiseRatio,
    });
  }

  if (
    typeof expect.min_link_rate === 'number' &&
    linkRate + 1e-9 < expect.min_link_rate
  ) {
    failures.push({
      type: 'link_rate_too_low',
      expected_min: expect.min_link_rate,
      actual: linkRate,
    });
  }

  if (
    typeof expect.max_incomplete_rate === 'number' &&
    incompleteRate > expect.max_incomplete_rate
  ) {
    failures.push({
      type: 'incomplete_rate_too_high',
      expected_max: expect.max_incomplete_rate,
      actual: incompleteRate,
    });
  }

  if (expect.silent_drop_allowed !== true && silentDrop) {
    failures.push({ type: 'silent_drop_detected', parseErrors });
  }

  if (
    typeof expect.min_parent_child_accuracy === 'number' &&
    parentChildAccuracy + 1e-9 < expect.min_parent_child_accuracy
  ) {
    failures.push({
      type: 'parent_child_accuracy_too_low',
      expected_min: expect.min_parent_child_accuracy,
      actual: parentChildAccuracy,
    });
  }

  const scores = {
    link_rate: round4(linkRate),
    explore_noise_ratio: round4(exploreNoiseRatio),
    incomplete_rate: round4(incompleteRate),
    parent_child_accuracy: round4(parentChildAccuracy),
    silent_drop: silentDrop,
    agent_tool_count: agents.length,
    program_record_count: programs.length,
    explore_tool_count: exploreCount,
  };

  return {
    pass: failures.length === 0,
    scores,
    failures,
  };
}

export function scoreOverhead({ baselineMs, tracedMs, expect = {} }) {
  const failures = [];
  const baseline = median(baselineMs);
  const traced = median(tracedMs);
  const overhead =
    baseline <= 0 ? Number.POSITIVE_INFINITY : (traced - baseline) / baseline;

  if (!Number.isFinite(overhead)) {
    failures.push({ type: 'overhead_undefined', baseline, traced });
  }

  if (
    typeof expect.max_latency_overhead_p50 === 'number' &&
    overhead > expect.max_latency_overhead_p50
  ) {
    failures.push({
      type: 'latency_overhead_too_high',
      expected_max: expect.max_latency_overhead_p50,
      actual: overhead,
      baseline_ms: baseline,
      traced_ms: traced,
    });
  }

  return {
    pass: failures.length === 0,
    scores: {
      latency_baseline_ms_p50: round4(baseline),
      latency_traced_ms_p50: round4(traced),
      latency_overhead_p50: round4(overhead),
      silent_drop: false,
    },
    failures,
    samples: {
      baselineMs,
      tracedMs,
    },
  };
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function round4(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value;
  return Math.round(value * 10000) / 10000;
}
