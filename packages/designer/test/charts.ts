import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const fixture = (name: string): string => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures", name), "utf8");

/** The chart the chart-simulation scenarios describe (idle, checkout.cart, paid). */
export const ORDER = `<?xml version="1.0" encoding="UTF-8"?>
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
      <transition event="pay" cond="ev.data.amount > 0" target="paid">
        <assign location="total" expr="ev.data.amount"/>
      </transition>
      <transition event="pay"><assign location="declined" expr="ctx.declined + 1"/></transition>
      <transition event="check"><raise event="checked"/></transition>
      <transition event="checked"><assign location="checks" expr="ctx.checks + 1"/></transition>
    </state>
  </state>
  <state id="paid"/>
  <state id="cancelled"/>
</scxml>
`;

/** A chart whose top-level `<final>` ends the run. */
export const WITH_FINAL = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="working">
  <state id="working"><transition event="finish" target="done"/></state>
  <final id="done"/>
</scxml>
`;

/** An unknown initial target on state `review`, a violation that names a state. */
export const BAD_REVIEW = `<?xml version="1.0" encoding="UTF-8"?>
<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="review">
  <state id="review" initial="nowhere">
    <state id="child"/>
  </state>
</scxml>
`;
