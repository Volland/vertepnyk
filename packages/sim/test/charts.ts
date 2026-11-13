// Charts of the sim tests. The order chart is the one the chart-simulation scenarios describe:
// `idle` --start--> `checkout.cart`; `pay` with a positive amount assigns `total` and ends in the
// final state `paid`; any other `pay` counts a declined payment and stays in `cart`; `check`
// raises the internal event `checked`; `cancel` leaves `checkout` from any child.
import { readFileSync } from "node:fs";

export const fixture = (name: string): string =>
  readFileSync(new URL(`../../../fixtures/${name}`, import.meta.url), "utf8");

export const orderChart = (guard = "ev.data.amount > 0"): string => `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="cel" name="order" initial="idle">
  <datamodel>
    <data id="total" expr="0"/>
    <data id="declined" expr="0"/>
    <data id="checks" expr="0"/>
  </datamodel>
  <state id="idle">
    <transition event="start" target="checkout"/>
  </state>
  <state id="checkout" initial="cart">
    <transition event="cancel" target="cancelled"/>
    <state id="cart">
      <transition event="pay" cond="${guard}" target="paid">
        <assign location="total" expr="ev.data.amount"/>
      </transition>
      <transition event="pay"><assign location="declined" expr="ctx.declined + 1"/></transition>
      <transition event="check"><raise event="checked"/></transition>
      <transition event="checked"><assign location="checks" expr="ctx.checks + 1"/></transition>
    </state>
  </state>
  <final id="paid"/>
  <final id="cancelled"/>
</scxml>
`;

export const ORDER = orderChart();

/** An event enables a transition in `inner` and in its ancestor `outer`. */
export const CONFLICT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="outer">
  <state id="outer" initial="inner">
    <transition event="e" target="fromAncestor"/>
    <state id="inner">
      <transition event="e" target="fromChild"/>
    </state>
  </state>
  <state id="fromAncestor"/>
  <state id="fromChild"/>
</scxml>`;

export const UNKNOWN_TARGET = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="a">
  <state id="a"><transition event="x" target="missing"/></state>
</scxml>`;

export const ECMA = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="a">
  <datamodel><data id="n" expr="1"/><data id="tags" expr="['x']"/></datamodel>
  <state id="a">
    <transition event="inc"><assign location="n" expr="n + _event.data.by"/></transition>
    <transition event="go" cond="n &gt; 2" target="b"/>
  </state>
  <state id="b"/>
</scxml>`;
