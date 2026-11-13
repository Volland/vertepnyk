/** The bundled example charts: copies of vertep's fixtures, imported as text. */
import order from "../../../fixtures/order.scxml?raw";
import trafficLightScxml from "../../../fixtures/traffic-light.scxml?raw";
import trafficLightYaml from "../../../fixtures/traffic-light.vt.yaml?raw";
import typedOrder from "../../../fixtures/typed-order.vt.yaml?raw";
import refund from "../../../fixtures/refund.scxml?raw";

export interface Example {
  readonly id: string;
  readonly label: string;
  readonly fileName: string;
  readonly text: string;
}

// @tg: implements:: [[openspec:web-shell#Example gallery]]
export const EXAMPLES: readonly Example[] = [
  { id: "order", label: "Order (SCXML)", fileName: "order.scxml", text: order },
  { id: "traffic-light", label: "Traffic light (SCXML)", fileName: "traffic-light.scxml", text: trafficLightScxml },
  { id: "traffic-light-yaml", label: "Traffic light (YAML)", fileName: "traffic-light.vt.yaml", text: trafficLightYaml },
  { id: "typed-order", label: "Typed order (YAML)", fileName: "typed-order.vt.yaml", text: typedOrder },
  { id: "refund", label: "Refund (SCXML)", fileName: "refund.scxml", text: refund },
];
