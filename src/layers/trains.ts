import { PathLayer } from "@deck.gl/layers";
import type { RailLine, TrainShape } from "../rail/rail.ts";
import { mixRgb } from "../color.ts";

/** Warm rust at night so a train reads against dark ground; a dark slate by day. */
const COLOR: [[number, number, number], [number, number, number]] = [[255, 176, 112], [118, 70, 42]];

/** The track itself, faint: a freight train is a dash on a line, and the line tells you where it is going. */
const TRACK: [[number, number, number], [number, number, number]] = [[200, 160, 130], [110, 84, 66]];

export function trainLayers(lines: RailLine[], trains: TrainShape[], daylight: number) {
  const color = mixRgb(COLOR[0], COLOR[1], daylight);
  const track = mixRgb(TRACK[0], TRACK[1], daylight);
  return [
    new PathLayer<RailLine>({
      id: "freight-track",
      data: lines,
      getPath: (l) => l.shape.path,
      getColor: [...track, 120],
      getWidth: 1,
      widthUnits: "pixels",
      parameters: { depthCompare: "always" },
      updateTriggers: { getColor: daylight },
    }),
    new PathLayer<TrainShape>({
      id: "freight-trains",
      data: trains,
      getPath: (t) => t.path,
      getColor: [...color, 235],
      getWidth: 3.2,
      widthUnits: "pixels",
      widthMinPixels: 2,
      capRounded: true,
      jointRounded: true,
      parameters: { depthCompare: "always" },
    }),
  ];
}
