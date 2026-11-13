/** The SVG views of one state, one transition and one initial arrow. Each reads narrow memos. */
import { For, Match, Show, Switch, createMemo, type JSX } from "solid-js";
import type { TransitionNode } from "@vertepnyk/core";
import { HEADER, edgeLabel, initialArrow, smoothPath } from "./geometry.js";
import { arrEq, rectEq, type Ctx } from "./ctx.js";

export function transitionAria(t: TransitionNode): string {
  const head = t.targets.length === 0 ? `internal transition on ${t.source}` : `transition from ${t.source} to ${t.targets.join(" and ")}`;
  const ev = t.events.length === 0 ? " without event" : ` on ${t.events.join(" ")}`;
  const cond = t.cond === undefined || t.cond === "" ? "" : ` if ${t.cond}`;
  return head + ev + cond;
}

// @tg: implements:: [[openspec:canvas-editing#Every SCXML state kind is drawn]]
// @tg: implements:: [[openspec:canvas-editing#Accessible canvas]]
export function StateView(p: { id: string; c: Ctx }): JSX.Element {
  const id = p.id;
  const c = p.c;
  const node = createMemo(() => c.model()?.states.get(id));
  const rect = createMemo(() => c.scene().rects.get(id), undefined, { equals: rectEq });
  const kind = createMemo(() => node()?.kind ?? "atomic");
  const hist = createMemo(() => node()?.historyType ?? "shallow");
  const tf = createMemo(() => {
    const r = rect();
    return r ? `translate(${r.x} ${r.y})` : "";
  });
  const w = createMemo(() => rect()?.w ?? 0);
  const h = createMemo(() => rect()?.h ?? 0);
  const selected = createMemo(() => c.selection().has(id));
  const active = createMemo(() => c.active(id));
  const sev = createMemo(() => c.diag(id)?.severity);
  const collapsed = createMemo(() => c.scene().collapsed.has(id));
  const provisional = createMemo(() => c.scene().provisional.has(id));
  const label = createMemo(() => `${kind() === "history" ? `${hist()} history` : kind()} state ${id}`);
  const showHandles = createMemo(() => !c.readOnly() && c.single() === id);
  const seps = createMemo(
    () => {
      const r = rect();
      const st = node();
      if (!r || !st || st.kind !== "parallel" || collapsed()) return [];
      const rs = (c.scene().kids.get(id) ?? []).map((k) => c.scene().rects.get(k)!).sort((a, b) => a.x - b.x);
      const out: string[] = [];
      for (let i = 1; i < rs.length; i++) {
        const x = (rs[i - 1]!.x + rs[i - 1]!.w + rs[i]!.x) / 2 - r.x;
        out.push(`M${x} ${HEADER}L${x} ${r.h}`);
      }
      return out;
    },
    [],
    { equals: arrEq },
  );
  const internals = createMemo(
    () => {
      const m = c.model();
      const st = node();
      if (!m || !st) return [];
      return st.transitions.filter((t) => m.transitions.get(t)?.targets.length === 0);
    },
    [],
    { equals: arrEq },
  );
  const isContainerKind = createMemo(() => kind() === "compound" || kind() === "parallel");

  return (
    <g
      class="vt-state"
      role="group"
      data-state-id={id}
      data-kind={kind()}
      data-x={rect()?.x}
      data-y={rect()?.y}
      data-w={w()}
      data-h={h()}
      data-selected={String(selected())}
      data-active={String(active())}
      data-severity={sev()}
      data-collapsed={String(collapsed())}
      data-provisional={String(provisional())}
      data-drop-target={String(c.dropTarget() === id)}
      aria-label={label()}
      tabindex={c.tabStop() === id ? 0 : -1}
      transform={tf()}
    >
      <Switch>
        <Match when={kind() === "history"}>
          <circle class="vt-box" cx={w() / 2} cy={h() / 2} r={Math.min(w(), h()) / 2} data-history={hist()} />
          <text class="vt-hist" x={w() / 2} y={h() / 2 + 4} data-history-marker={hist()}>
            {hist() === "deep" ? "H*" : "H"}
          </text>
        </Match>
        <Match when={kind() === "final"}>
          <rect class="vt-box" width={w()} height={h()} rx={8} />
          <rect class="vt-inner" x={4} y={4} width={Math.max(0, w() - 8)} height={Math.max(0, h() - 8)} rx={5} />
          <text class="vt-name" x={w() / 2} y={h() / 2 + 4} text-anchor="middle">
            {id}
          </text>
        </Match>
        <Match when={isContainerKind()}>
          <rect class="vt-box" width={w()} height={h()} rx={10} />
          <Show when={!collapsed()}>
            <path class="vt-header" d={`M0 ${HEADER}L${w()} ${HEADER}`} />
          </Show>
          <text class="vt-name" x={12} y={23}>
            {id}
          </text>
          <text class="vt-tag" x={w() - 44} y={23} text-anchor="end">
            {kind() === "parallel" ? "‖ parallel" : ""}
          </text>
          <g class="vt-toggle" data-toggle={id} transform={`translate(${w() - 20} 17)`}>
            <circle r={9} fill="transparent" />
            <text y={4}>{collapsed() ? "+" : "−"}</text>
          </g>
          <For each={seps()}>{(d) => <path class="vt-sep" data-separator="true" d={d} />}</For>
        </Match>
        <Match when={true}>
          <rect class="vt-box" width={w()} height={h()} rx={8} />
          <text class="vt-name" x={w() / 2} y={h() / 2 + 4} text-anchor="middle">
            {id}
          </text>
        </Match>
      </Switch>
      <For each={internals()}>{(tid, i) => <InternalBadge tid={tid} index={i} c={c} h={h} />}</For>
      <Show when={showHandles()}>
        <circle class="vt-port" data-port={id} cx={w()} cy={h() / 2} r={5} />
        <Show when={!collapsed() && kind() !== "history"}>
          <rect class="vt-resize" data-resize={id} x={w() - 7} y={h() - 7} width={9} height={9} rx={2} />
        </Show>
      </Show>
    </g>
  );
}

// @tg: implements:: [[openspec:canvas-editing#Transitions are drawn with their labels]]
function InternalBadge(p: { tid: string; index: () => number; c: Ctx; h: () => number }): JSX.Element {
  const c = p.c;
  const t = createMemo(() => c.model()?.transitions.get(p.tid));
  const text = createMemo(() => {
    const x = t();
    return x ? `↻ ${edgeLabel(x)}` : "";
  });
  const aria = createMemo(() => {
    const x = t();
    return x ? transitionAria(x) : "";
  });
  return (
    <g
      class="vt-internal-g"
      role="group"
      data-transition-id={p.tid}
      data-internal="true"
      data-selected={String(c.selection().has(p.tid))}
      data-taken={String(c.taken(p.tid))}
      aria-label={aria()}
      tabindex={c.tabStop() === p.tid ? 0 : -1}
      transform={`translate(8 ${p.h() + 14 + p.index() * 14})`}
    >
      <text class="vt-internal">{text()}</text>
    </g>
  );
}

// @tg: implements:: [[openspec:canvas-editing#Transitions are drawn with their labels]]
export function EdgeView(p: { id: string; c: Ctx }): JSX.Element {
  const id = p.id;
  const c = p.c;
  const edge = createMemo(() => c.edges().get(id));
  const t = createMemo(() => c.model()?.transitions.get(id));
  const parts = createMemo(() => edge()?.parts.map((q) => smoothPath(q)) ?? [], [], { equals: arrEq });
  const label = createMemo(() => edge()?.label ?? "");
  const lx = createMemo(() => edge()?.labelPos[0] ?? 0);
  const ly = createMemo(() => edge()?.labelPos[1] ?? 0);
  const selected = createMemo(() => c.selection().has(id));
  const taken = createMemo(() => c.taken(id));
  const sev = createMemo(() => c.diag(id)?.severity);
  const marker = createMemo(() => `url(#${c.uid}-${selected() ? "sel" : taken() ? "act" : sev() === "error" ? "err" : "n"})`);
  const aria = createMemo(() => {
    const x = t();
    return x ? transitionAria(x) : "";
  });
  const ends = createMemo(
    () => {
      const e = edge();
      if (!e) return [];
      return e.parts.map((q) => `${q[q.length - 1]![0]},${q[q.length - 1]![1]}`);
    },
    [],
    { equals: arrEq },
  );
  const start = createMemo(() => {
    const q = edge()?.parts[0]?.[0];
    return q ? `${q[0]},${q[1]}` : "0,0";
  });
  const xy = (s: string): [number, number] => {
    const [a, b] = s.split(",");
    return [Number(a), Number(b)];
  };
  return (
    <g
      class="vt-edge"
      role="group"
      data-transition-id={id}
      data-eventless={String(edge()?.eventless ?? false)}
      data-selected={String(selected())}
      data-taken={String(taken())}
      data-severity={sev()}
      aria-label={aria()}
      tabindex={c.tabStop() === id ? 0 : -1}
    >
      <For each={parts()}>
        {(d) => (
          <>
            <path class="vt-hit" d={d} />
            <path class="vt-line" d={d} marker-end={marker()} />
          </>
        )}
      </For>
      <text class="vt-label" data-edge-label="true" x={lx()} y={ly()}>
        {label()}
      </text>
      <Show when={selected() && !c.readOnly()}>
        <circle class="vt-end" data-end="source" cx={xy(start())[0]} cy={xy(start())[1]} r={5} />
        <For each={ends()}>{(e, i) => <circle class="vt-end" data-end="target" data-index={i()} cx={xy(e)[0]} cy={xy(e)[1]} r={5} />}</For>
      </Show>
    </g>
  );
}

export function InitialView(p: { id: string; c: Ctx }): JSX.Element {
  const c = p.c;
  const info = createMemo(() => c.initials().get(p.id));
  const geo = createMemo(() => {
    const tgt = info()?.target;
    const r = tgt === undefined ? undefined : c.scene().rects.get(tgt);
    return r ? initialArrow(r) : null;
  });
  const d = createMemo(() => geo()?.d ?? "");
  const cx = createMemo(() => geo()?.dot[0] ?? 0);
  const cy = createMemo(() => geo()?.dot[1] ?? 0);
  return (
    <g class="vt-initial" data-initial={p.id} aria-hidden="true">
      <circle class="vt-initial-dot" cx={cx()} cy={cy()} r={4} />
      <path class="vt-initial-line" d={d()} marker-end={`url(#${c.uid}-ini)`} />
    </g>
  );
}
