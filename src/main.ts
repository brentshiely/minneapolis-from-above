import "./style.css";
import { createBaseMap } from "./basemap";

const map = createBaseMap(document.getElementById("map")!);

// Exposed for debugging in the browser console.
(window as unknown as { godmode: unknown }).godmode = { map };
