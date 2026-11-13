import { For, Index, Match, Show, Switch, createContext, createEffect, createMemo, createSignal, createUniqueId, onCleanup, useContext, type Accessor, type JSX } from "solid-js";
import type { ChartDocument, ChartModel, Command, ContentItem, ContentOwner, Span, StateKind, StateNode, TransitionNode } from "@vertepnyk/core";
import type { ThemeTokens } from "@vertepnyk/host-bridge";
import { ITEM_KINDS, addBranch, contentOps, describeSelection, eventSuggestions, opt, removeBranch, showTypeInput, summaryText, type IfItem, type ItemKind, type SelectionView } from "./ops.js";
import { themeVars } from "./theme.js";

export type ExprKind = "guard" | "expr" | "location";
export interface ExprCheckRequest {
  readonly kind: ExprKind;
  readonly text: string;
  readonly ownerId: string;
}
export type CheckExpression = (req: ExprCheckRequest) => Promise<{ message: string } | null>;

export interface InspectorProps {
  doc: ChartDocument;
  /** State ids and `source#index` transition ids. */
  selection: readonly string[];
  theme?: ThemeTokens;
  checkExpression?: CheckExpression;
  /** Reveal a span in the text view (opaque content). */
  onRevealText?: (span: Span) => void;
  onError?: (error: Error) => void;
  /** Ask the host to change the selection (after a rename, or to open an outgoing transition). */
  onSelect?: (ids: readonly string[]) => void;
  /** Delay before an expression is checked after typing; default 250. */
  debounceMs?: number;
}

interface Ctx {
  model: Accessor<ChartModel>;
  run(cmd: Command, mergeKey?: string): boolean;
  check?: CheckExpression;
  debounceMs: number;
  reveal?: (span: Span) => void;
}
const InspectorCtx = createContext<Ctx>();
const useCtx = (): Ctx => useContext(InspectorCtx)!;

const KINDS: readonly StateKind[] = ["atomic", "compound", "parallel", "final", "history"];
const DATAMODELS = ["null", "ecmascript", "cel"];

/** A labelled text field; `onInput` fires per keystroke, `onChange` on blur/Enter. Expression fields are checked, never blocked. */
function Field(props: {
  label: string;
  value: () => string;
  onInput?: (v: string) => void;
  onChange?: (v: string) => void;
  check?: ExprKind;
  ownerId?: string;
  placeholder?: string;
  mono?: boolean;
}): JSX.Element {
  const ctx = useCtx();
  const id = createUniqueId();
  const errId = `${id}-err`;
  const [err, setErr] = createSignal<string | null>(null);
  let seq = 0;
  createEffect(() => {
    const text = props.value();
    const kind = props.check;
    if (!kind || !ctx.check || text.trim() === "") {
      seq++;
      setErr(null);
      return;
    }
    const mine = ++seq;
    const timer = setTimeout(() => {
      ctx
        .check!({ kind, text, ownerId: props.ownerId ?? "" })
        .then((r) => {
          if (mine === seq) setErr(r ? r.message : null);
        })
        .catch(() => {
          if (mine === seq) setErr(null);
        });
    }, ctx.debounceMs);
    onCleanup(() => clearTimeout(timer));
  });
  return (
    <div class="vi-field">
      <label for={id}>{props.label}</label>
      <input
        id={id}
        type="text"
        value={props.value()}
        placeholder={props.placeholder}
        classList={{ "vi-mono": props.mono ?? props.check !== undefined }}
        aria-invalid={err() ? "true" : undefined}
        aria-describedby={err() ? errId : undefined}
        onInput={(e) => props.onInput?.(e.currentTarget.value)}
        onChange={(e) => props.onChange?.(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") props.onChange?.(e.currentTarget.value);
        }}
      />
      <Show when={err()}>
        <div id={errId} class="vi-error" role="alert">
          {err()}
        </div>
      </Show>
    </div>
  );
}

function SelectField(props: { label: string; value: () => string; options: readonly { value: string; label?: string }[]; onChange: (v: string) => void }): JSX.Element {
  const id = createUniqueId();
  return (
    <div class="vi-field">
      <label for={id}>{props.label}</label>
      <select id={id} onChange={(e) => props.onChange(e.currentTarget.value)}>
        <For each={props.options}>
          {(o) => (
            <option value={o.value} selected={props.value() === o.value}>
              {o.label ?? o.value}
            </option>
          )}
        </For>
      </select>
    </div>
  );
}

// @tg: implements:: [[openspec:chart-inspector#Event catalogue]]
/** Chips input with autocomplete from the chart's event catalogue; accepts new names. */
function EventsField(props: { value: () => readonly string[]; onChange: (events: string[]) => void }): JSX.Element {
  const ctx = useCtx();
  const id = createUniqueId();
  const [draft, setDraft] = createSignal("");
  const suggestions = createMemo(() => (draft().trim() === "" ? [] : eventSuggestions(ctx.model(), draft(), props.value())));
  const add = (name: string) => {
    const n = name.trim();
    setDraft("");
    if (n === "" || props.value().includes(n)) return;
    props.onChange([...props.value(), n]);
  };
  return (
    <div class="vi-field" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`}>Events</span>
      <ul class="vi-chips">
        <Index each={props.value()}>
          {(ev) => (
            <li class="vi-chip">
              <span>{ev()}</span>
              <button type="button" aria-label={`Remove event ${ev()}`} onClick={() => props.onChange(props.value().filter((x) => x !== ev()))}>
                x
              </button>
            </li>
          )}
        </Index>
      </ul>
      <input
        type="text"
        aria-label="Add event"
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        value={draft()}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(e.currentTarget.value);
          } else if (e.key === "Backspace" && draft() === "" && props.value().length > 0) props.onChange(props.value().slice(0, -1));
        }}
        onChange={(e) => add(e.currentTarget.value)}
      />
      <ul id={`${id}-list`} role="listbox" aria-label="Event suggestions" hidden={suggestions().length === 0}>
        <For each={suggestions()}>
          {(s) => (
            <li role="option" aria-selected="false" tabindex="0" onMouseDown={(e) => e.preventDefault()} onClick={() => add(s)} onKeyDown={(e) => e.key === "Enter" && add(s)}>
              {s}
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}

function TargetsField(props: { value: () => readonly string[]; ids: () => readonly string[]; onChange: (t: string[]) => void }): JSX.Element {
  const id = createUniqueId();
  return (
    <div class="vi-field" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`}>Targets</span>
      <ul class="vi-chips">
        <Index each={props.value()}>
          {(t) => (
            <li class="vi-chip">
              <span>{t()}</span>
              <button type="button" aria-label={`Remove target ${t()}`} onClick={() => props.onChange(props.value().filter((x) => x !== t()))}>
                x
              </button>
            </li>
          )}
        </Index>
      </ul>
      <select
        aria-label="Add target"
        onChange={(e) => {
          const v = e.currentTarget.value;
          e.currentTarget.value = "";
          if (v !== "" && !props.value().includes(v)) props.onChange([...props.value(), v]);
        }}
      >
        <option value="">Add target...</option>
        <For each={props.ids().filter((s) => !props.value().includes(s))}>{(s) => <option value={s}>{s}</option>}</For>
      </select>
    </div>
  );
}

// @tg: implements:: [[openspec:chart-inspector#Edit executable content]]
// @tg: implements:: [[openspec:chart-inspector#Unmodeled content is shown read-only]]
/** An editable list of executable content; every edit reports the full new list. */
function ItemList(props: { label: string; items: () => readonly ContentItem[]; onChange: (items: ContentItem[], key: string) => void; ownerId: string; path: string }): JSX.Element {
  const id = createUniqueId();
  return (
    <section class="vi-items" aria-label={props.label}>
      <h4 id={`${id}-h`}>{props.label}</h4>
      <ol aria-labelledby={`${id}-h`}>
        <Index each={props.items()}>
          {(item, i) => (
            <li class="vi-item" data-kind={item().kind}>
              <div class="vi-item-bar">
                <strong>{item().kind === "opaque" ? (item() as Extract<ContentItem, { kind: "opaque" }>).label : item().kind}</strong>
                <button type="button" aria-label={`Move ${item().kind} up`} disabled={i === 0} onClick={() => props.onChange(contentOps.move(props.items(), i, -1), `${props.path}:move`)}>
                  Up
                </button>
                <button type="button" aria-label={`Move ${item().kind} down`} disabled={i === props.items().length - 1} onClick={() => props.onChange(contentOps.move(props.items(), i, 1), `${props.path}:move`)}>
                  Down
                </button>
                <button type="button" aria-label={`Remove ${item().kind}`} onClick={() => props.onChange(contentOps.remove(props.items(), i), `${props.path}:remove`)}>
                  Remove
                </button>
              </div>
              <ItemForm item={item} ownerId={props.ownerId} path={`${props.path}.${i}`} onChange={(it, key) => props.onChange(contentOps.replace(props.items(), i, it), key)} />
            </li>
          )}
        </Index>
      </ol>
      <select
        aria-label={`Add item to ${props.label}`}
        onChange={(e) => {
          const k = e.currentTarget.value as ItemKind;
          e.currentTarget.value = "";
          if (k) props.onChange(contentOps.add(props.items(), k), `${props.path}:add`);
        }}
      >
        <option value="">Add...</option>
        <For each={ITEM_KINDS}>{(k) => <option value={k}>{k}</option>}</For>
      </select>
    </section>
  );
}

function ItemForm(props: { item: () => ContentItem; ownerId: string; path: string; onChange: (item: ContentItem, key: string) => void }): JSX.Element {
  const ctx = useCtx();
  /** Typed view of the current item; the Match guards ensure the kind. */
  const as = <K extends ContentItem["kind"]>(_k: K) => props.item as () => Extract<ContentItem, { kind: K }>;
  const ed = <K extends ContentItem["kind"]>(_k: K, field: string) => (patch: Partial<Extract<ContentItem, { kind: K }>>) =>
    props.onChange({ ...(props.item() as Extract<ContentItem, { kind: K }>), ...patch } as ContentItem, `${props.path}:${field}`);
  const o = props.ownerId;
  return (
    <Switch>
      <Match when={props.item().kind === "assign"}>
        <Field label="Location" check="location" ownerId={o} value={() => as("assign")().location} onInput={(v) => ed("assign", "location")({ location: v })} />
        <Field label="Expression" check="expr" ownerId={o} value={() => as("assign")().expr} onInput={(v) => ed("assign", "expr")({ expr: v })} />
      </Match>
      <Match when={props.item().kind === "raise"}>
        <Field label="Event" value={() => as("raise")().event} onInput={(v) => ed("raise", "event")({ event: v })} />
      </Match>
      <Match when={props.item().kind === "send"}>
        <Field label="Event" value={() => as("send")().event ?? ""} onInput={(v) => ed("send", "event")({ event: opt(v) })} />
        <Field label="Event expression" check="expr" ownerId={o} value={() => as("send")().eventexpr ?? ""} onInput={(v) => ed("send", "eventexpr")({ eventexpr: opt(v) })} />
        <Field label="Target" value={() => as("send")().target ?? ""} onInput={(v) => ed("send", "target")({ target: opt(v) })} />
        <Field label="Type" value={() => as("send")().type ?? ""} onInput={(v) => ed("send", "type")({ type: opt(v) })} />
        <Field label="Delay" check="expr" ownerId={o} value={() => as("send")().delay ?? ""} onInput={(v) => ed("send", "delay")({ delay: opt(v) })} />
        <Field label="Id" value={() => as("send")().sendid ?? ""} onInput={(v) => ed("send", "sendid")({ sendid: opt(v) })} />
        <fieldset class="vi-params">
          <legend>Params</legend>
          <Index each={as("send")().params ?? []}>
            {(p, pi) => (
              <div class="vi-row">
                <Field
                  label="Param name"
                  value={() => p().name}
                  onInput={(v) => ed("send", `p${pi}n`)({ params: (as("send")().params ?? []).map((x, j) => (j === pi ? { ...x, name: v } : x)) })}
                />
                <Field
                  label="Param expression"
                  check="expr"
                  ownerId={o}
                  value={() => p().expr}
                  onInput={(v) => ed("send", `p${pi}e`)({ params: (as("send")().params ?? []).map((x, j) => (j === pi ? { ...x, expr: v } : x)) })}
                />
                <button type="button" aria-label="Remove param" onClick={() => ed("send", "pdel")({ params: (as("send")().params ?? []).filter((_, j) => j !== pi) })}>
                  Remove
                </button>
              </div>
            )}
          </Index>
          <button type="button" onClick={() => ed("send", "padd")({ params: [...(as("send")().params ?? []), { name: "", expr: "" }] })}>
            Add param
          </button>
        </fieldset>
      </Match>
      <Match when={props.item().kind === "log"}>
        <Field label="Label" value={() => as("log")().label ?? ""} onInput={(v) => ed("log", "label")({ label: opt(v) })} />
        <Field label="Expression" check="expr" ownerId={o} value={() => as("log")().expr ?? ""} onInput={(v) => ed("log", "expr")({ expr: opt(v) })} />
      </Match>
      <Match when={props.item().kind === "cancel"}>
        <Field label="Send id" value={() => as("cancel")().sendid ?? ""} onInput={(v) => ed("cancel", "sendid")({ sendid: opt(v) })} />
        <Field label="Send id expression" check="expr" ownerId={o} value={() => as("cancel")().sendidexpr ?? ""} onInput={(v) => ed("cancel", "sendidexpr")({ sendidexpr: opt(v) })} />
      </Match>
      <Match when={props.item().kind === "if"}>
        <IfForm item={as("if")} ownerId={o} path={props.path} onChange={props.onChange} />
      </Match>
      <Match when={props.item().kind === "foreach"}>
        <Field label="Array" check="expr" ownerId={o} value={() => as("foreach")().array} onInput={(v) => ed("foreach", "array")({ array: v })} />
        <Field label="Item" value={() => as("foreach")().item} onInput={(v) => ed("foreach", "item")({ item: v })} />
        <Field label="Index" value={() => as("foreach")().index ?? ""} onInput={(v) => ed("foreach", "index")({ index: opt(v) })} />
        <ItemList
          label="Body"
          ownerId={o}
          path={`${props.path}.body`}
          items={() => as("foreach")().actions}
          onChange={(actions, key) => props.onChange({ ...as("foreach")(), actions }, key)}
        />
      </Match>
      <Match when={props.item().kind === "opaque"}>
        <div class="vi-opaque">
          <pre aria-label="Source (read-only)">{(props.item() as Extract<ContentItem, { kind: "opaque" }>).source}</pre>
          <button type="button" onClick={() => ctx.reveal?.((props.item() as Extract<ContentItem, { kind: "opaque" }>).span)} disabled={!ctx.reveal}>
            Show in text
          </button>
        </div>
      </Match>
    </Switch>
  );
}

function IfForm(props: { item: () => IfItem; ownerId: string; path: string; onChange: (item: ContentItem, key: string) => void }): JSX.Element {
  const branch = (bi: number, patch: Partial<IfItem["branches"][number]>, key: string) =>
    props.onChange({ ...props.item(), branches: props.item().branches.map((b, j) => (j === bi ? { ...b, ...patch } : b)) }, key);
  return (
    <div class="vi-if">
      <Index each={props.item().branches}>
        {(b, bi) => (
          <div class="vi-branch">
            <Show
              when={b().cond !== undefined}
              fallback={<strong>else</strong>}
            >
              <Field label={bi === 0 ? "If condition" : "Else-if condition"} check="guard" ownerId={props.ownerId} value={() => b().cond ?? ""} onInput={(v) => branch(bi, { cond: v }, `${props.path}.b${bi}:cond`)} />
            </Show>
            <Show when={bi > 0}>
              <button type="button" aria-label="Remove branch" onClick={() => props.onChange(removeBranch(props.item(), bi), `${props.path}:rmbranch`)}>
                Remove branch
              </button>
            </Show>
            <ItemList label={bi === 0 ? "Then" : b().cond === undefined ? "Else" : "Else-if body"} ownerId={props.ownerId} path={`${props.path}.b${bi}`} items={() => b().actions} onChange={(actions, key) => branch(bi, { actions }, key)} />
          </div>
        )}
      </Index>
      <button type="button" onClick={() => props.onChange(addBranch(props.item(), "elseif"), `${props.path}:elseif`)}>
        Add elseif
      </button>
      <button type="button" onClick={() => props.onChange(addBranch(props.item(), "else"), `${props.path}:else`)}>
        Add else
      </button>
    </div>
  );
}

/** Content editor bound to a document owner (onentry, onexit or a transition's actions). */
function OwnerContent(props: { label: string; owner: ContentOwner; items: () => readonly ContentItem[]; ownerId: string }): JSX.Element {
  const ctx = useCtx();
  const key = "state" in props.owner ? `c:${props.owner.state}:${props.owner.slot}` : `c:${props.owner.transition}`;
  return (
    <ItemList
      label={props.label}
      ownerId={props.ownerId}
      path={key}
      items={props.items}
      onChange={(items, k) => ctx.run({ type: "setContent", owner: props.owner, items }, k)}
    />
  );
}

// @tg: implements:: [[openspec:chart-inspector#Inspect the selection]]
function StateForm(props: { id: string; onSelect?: (ids: readonly string[]) => void }): JSX.Element {
  const ctx = useCtx();
  const st = createMemo<StateNode | undefined>(() => ctx.model().states.get(props.id));
  const outgoing = createMemo(() => (st()?.transitions ?? []).map((t) => ctx.model().transitions.get(t)).filter((t): t is TransitionNode => t !== undefined));
  const children = createMemo(() => st()?.children ?? []);
  const flat = (blocks: readonly { items: readonly ContentItem[] }[] | undefined) => (blocks ?? []).flatMap((b) => b.items);
  return (
    <Show when={st()}>
      <form class="vi-form" aria-label={`State ${props.id}`} onSubmit={(e) => e.preventDefault()}>
        <h3>State</h3>
        <Field
          label="Id"
          value={() => props.id}
          onChange={(v) => {
            const n = v.trim();
            if (n !== "" && n !== props.id && ctx.run({ type: "renameState", id: props.id, newId: n })) props.onSelect?.([n]);
          }}
        />
        <SelectField
          label="Kind"
          value={() => st()!.kind}
          options={KINDS.map((k) => ({ value: k }))}
          onChange={(v) => ctx.run({ type: "setStateKind", id: props.id, kind: v as StateKind, ...(v === "history" ? { historyType: st()!.historyType ?? "shallow" } : {}) })}
        />
        <Show when={st()!.kind === "history"}>
          <SelectField
            label="History type"
            value={() => st()!.historyType ?? "shallow"}
            options={[{ value: "shallow" }, { value: "deep" }]}
            onChange={(v) => ctx.run({ type: "setStateKind", id: props.id, kind: "history", historyType: v as "shallow" | "deep" })}
          />
        </Show>
        <Show when={st()!.kind === "compound"}>
          <SelectField
            label="Initial child"
            value={() => st()!.initial[0] ?? ""}
            options={[{ value: "", label: "(first child)" }, ...children().map((c) => ({ value: c }))]}
            onChange={(v) => ctx.run({ type: "setInitial", state: props.id, initial: v === "" ? [] : [v] })}
          />
        </Show>
        <OwnerContent label="On entry" owner={{ state: props.id, slot: "onentry" }} ownerId={props.id} items={() => flat(st()?.onentry)} />
        <OwnerContent label="On exit" owner={{ state: props.id, slot: "onexit" }} ownerId={props.id} items={() => flat(st()?.onexit)} />
        <section aria-label="Outgoing transitions">
          <h4>Outgoing transitions</h4>
          <ul>
            <For each={outgoing()}>
              {(t) => (
                <li>
                  <button type="button" onClick={() => props.onSelect?.([t.id])}>
                    {(t.events.join(" ") || "(eventless)") + (t.cond ? ` [${t.cond}]` : "") + " -> " + (t.targets.join(" ") || "(none)")}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </section>
      </form>
    </Show>
  );
}

// @tg: implements:: [[openspec:chart-inspector#Inspect the selection]]
// @tg: implements:: [[openspec:chart-inspector#Expression fields are checked]]
function TransitionForm(props: { id: string }): JSX.Element {
  const ctx = useCtx();
  const tr = createMemo<TransitionNode | undefined>(() => ctx.model().transitions.get(props.id));
  const stateIds = createMemo(() => [...ctx.model().states.keys()]);
  const up = (patch: Omit<Extract<Command, { type: "updateTransition" }>, "type" | "id">, key?: string) => ctx.run({ type: "updateTransition", id: props.id, ...patch }, key);
  return (
    <Show when={tr()}>
      <form class="vi-form" aria-label={`Transition ${props.id}`} onSubmit={(e) => e.preventDefault()}>
        <h3>Transition</h3>
        <SelectField label="Source" value={() => tr()!.source} options={stateIds().map((s) => ({ value: s }))} onChange={(v) => v !== tr()!.source && up({ source: v })} />
        <EventsField value={() => tr()!.events} onChange={(events) => up({ events })} />
        <Field label="Guard" check="guard" ownerId={props.id} value={() => tr()!.cond ?? ""} onInput={(v) => up({ cond: v === "" ? null : v }, `t:${props.id}:cond`)} />
        <TargetsField value={() => tr()!.targets} ids={stateIds} onChange={(targets) => up({ targets })} />
        <SelectField label="Type" value={() => tr()!.type} options={[{ value: "external" }, { value: "internal" }]} onChange={(v) => up({ transitionType: v as "external" | "internal" })} />
        <OwnerContent label="Actions" owner={{ transition: props.id }} ownerId={props.id} items={() => tr()?.actions ?? []} />
      </form>
    </Show>
  );
}

// @tg: implements:: [[openspec:chart-inspector#Edit the datamodel]]
function ChartForm(): JSX.Element {
  const ctx = useCtx();
  const m = ctx.model;
  const [newId, setNewId] = createSignal("");
  const [newExpr, setNewExpr] = createSignal("");
  const [newType, setNewType] = createSignal("");
  const typed = createMemo(() => showTypeInput(m()));
  return (
    <form class="vi-form" aria-label="Chart" onSubmit={(e) => e.preventDefault()}>
      <h3>Chart</h3>
      <Field label="Name" value={() => m().name ?? ""} onInput={(v) => ctx.run({ type: "setChartProps", name: v === "" ? null : v }, "chart:name")} />
      <SelectField
        label="Datamodel"
        value={() => m().datamodel ?? "null"}
        options={[...DATAMODELS, ...(m().datamodel && !DATAMODELS.includes(m().datamodel!) ? [m().datamodel!] : [])].map((v) => ({ value: v }))}
        onChange={(v) => ctx.run({ type: "setChartProps", datamodel: v })}
      />
      <section aria-label="Datamodel items">
        <h4>Data</h4>
        <ul>
          <Index each={m().data}>
            {(d) => (
              <li class="vi-row" data-owner={d().owner ?? ""}>
                <Field label="Data id" value={() => d().id} onChange={(v) => v.trim() !== "" && v !== d().id && ctx.run({ type: "updateData", id: d().id, newId: v.trim() })} />
                <Field label="Initial expression" check="expr" ownerId={d().owner ?? ""} value={() => d().expr ?? ""} onInput={(v) => ctx.run({ type: "updateData", id: d().id, expr: v === "" ? null : v }, `d:${d().id}:expr`)} />
                <Show when={typed()}>
                  <Field label="Type" value={() => d().type ?? ""} onInput={(v) => ctx.run({ type: "updateData", id: d().id, dataType: v === "" ? null : v }, `d:${d().id}:type`)} />
                </Show>
                <button type="button" aria-label={`Remove data ${d().id}`} onClick={() => ctx.run({ type: "removeData", id: d().id })}>
                  Remove
                </button>
              </li>
            )}
          </Index>
        </ul>
        <fieldset class="vi-row">
          <legend>Add data item</legend>
          <Field label="New data id" value={newId} onInput={setNewId} />
          <Field label="New initial expression" check="expr" value={newExpr} onInput={setNewExpr} />
          <Show when={typed()}>
            <Field label="New data type" value={newType} onInput={setNewType} />
          </Show>
          <button
            type="button"
            disabled={newId().trim() === ""}
            onClick={() => {
              const ok = ctx.run({ type: "addData", owner: null, id: newId().trim(), ...(newExpr() !== "" ? { expr: newExpr() } : {}), ...(typed() && newType() !== "" ? { dataType: newType() } : {}) });
              if (ok) {
                setNewId("");
                setNewExpr("");
                setNewType("");
              }
            }}
          >
            Add data
          </button>
        </fieldset>
      </section>
    </form>
  );
}

const CSS = `
.vi-root{background:var(--vi-bg);color:var(--vi-fg);font-family:var(--vi-font);font-size:var(--vi-font-size);padding:8px;overflow:auto}
.vi-field{display:flex;flex-direction:column;gap:2px;margin:6px 0}
.vi-field input,.vi-field select{background:var(--vi-fill);color:inherit;border:1px solid var(--vi-border);padding:3px 5px}
.vi-field input:focus,.vi-root button:focus-visible,.vi-root select:focus-visible{outline:2px solid var(--vi-accent)}
.vi-mono,.vi-opaque pre{font-family:var(--vi-mono)}
.vi-error{color:var(--vi-error);font-size:90%}
.vi-chips{list-style:none;display:flex;flex-wrap:wrap;gap:4px;padding:0;margin:0}
.vi-chip{border:1px solid var(--vi-border);border-radius:10px;padding:0 6px}
.vi-items ol{list-style:none;padding:0}
.vi-item{border:1px solid var(--vi-border);padding:4px;margin:4px 0}
.vi-item-bar{display:flex;gap:4px;align-items:center}
.vi-item-bar strong{flex:1}
[role=listbox]{list-style:none;padding:0;margin:0;border:1px solid var(--vi-border)}
[role=option]{cursor:pointer;padding:2px 6px}
[role=option]:focus,[role=option]:hover{background:var(--vi-accent);color:var(--vi-bg)}
.vi-muted{color:var(--vi-muted)}
`;

// @tg: implements:: [[openspec:chart-inspector#Inspect the selection]]
// @tg: implements:: [[openspec:chart-inspector#Edit the datamodel]]
/** The inspector panel: forms for the selected state, transition or the chart. */
export function Inspector(props: InspectorProps): JSX.Element {
  const [model, setModel] = createSignal<ChartModel | null>(props.doc.model, { equals: false });
  const off = props.doc.onChange((c) => {
    if (c.model) setModel(c.model);
  });
  onCleanup(off);
  const ctx: Ctx = {
    model: model as Accessor<ChartModel>,
    run(cmd, mergeKey) {
      try {
        props.doc.apply(cmd, mergeKey ? { mergeKey } : undefined);
        return true;
      } catch (e) {
        props.onError?.(e instanceof Error ? e : new Error(String(e)));
        return false;
      }
    },
    get check() {
      return props.checkExpression;
    },
    get debounceMs() {
      return props.debounceMs ?? 250;
    },
    get reveal() {
      return props.onRevealText;
    },
  };
  const view = createMemo(
    () => {
      const m = model();
      return m ? describeSelection(m, props.selection) : null;
    },
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  return (
    <InspectorCtx.Provider value={ctx}>
      <div class="vi-root" role="region" aria-label="Inspector" style={props.theme ? themeVars(props.theme) : undefined}>
        <style>{CSS}</style>
        <Show when={view()} fallback={<p class="vi-muted">The chart does not parse yet.</p>}>
          {(v) => (
            <Switch>
              <Match when={v().kind === "chart"}>
                <ChartForm />
              </Match>
              <Match when={v().kind === "state"}>
                <Show when={(v() as { id: string }).id} keyed>
                  {(id) => <StateForm id={id} onSelect={props.onSelect} />}
                </Show>
              </Match>
              <Match when={v().kind === "transition"}>
                <Show when={(v() as { id: string }).id} keyed>
                  {(id) => <TransitionForm id={id} />}
                </Show>
              </Match>
              <Match when={v().kind === "multiple"}>
                <p role="status">{summaryText(v() as Extract<SelectionView, { kind: "multiple" }>)}</p>
              </Match>
              <Match when={v().kind === "missing"}>
                <p class="vi-muted">The selection no longer exists.</p>
              </Match>
            </Switch>
          )}
        </Show>
      </div>
    </InspectorCtx.Provider>
  );
}
