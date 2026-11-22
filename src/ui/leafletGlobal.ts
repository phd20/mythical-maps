/** Publishes the bundled Leaflet as the global `L` that Geoman patches (see `geoman.ts`). Must be imported first. */
import * as L from "leaflet";

(globalThis as { L?: unknown }).L = L;
