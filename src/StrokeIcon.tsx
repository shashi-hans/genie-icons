import type * as React from "react";
import { IconBase } from "./IconBase";
import type { IconProps } from "./types";
import { STROKE_WIDTHS } from "./strokeWeights";

// Renders an icon defined by centerline paths, deriving every weight at render
// time:
//   thin / regular / bold -> the same paths stroked at three widths,
//   fill                  -> the paths filled as solid silhouettes,
//   duotone               -> a faded fill behind the regular stroke.
// One drawing, five coherent weights — no per-weight artwork to keep in sync.
// `color` drives the stroke (or fill), matching the rest of the library's API.
//
// A separate path per disconnected line is what makes compound icons work: a
// clock is a ring path plus a hands path, and both take the same stroke width.
// `d` is widened to a path list, so the inherited SVG `d?: string` is omitted.
export interface StrokeIconProps extends Omit<IconProps, "d"> {
  /** The centerline path data the weights are derived from. */
  d: string | readonly string[];
}

const toList = (d: string | readonly string[]): readonly string[] =>
  typeof d === "string" ? [d] : d;

export function StrokeIcon({
  d,
  weight = "regular",
  color = "currentColor",
  ...props
}: StrokeIconProps): React.ReactElement {
  const paths = toList(d);

  if (weight === "fill") {
    return (
      <IconBase {...props} color={color}>
        {paths.map((path, i) => (
          <path key={i} d={path} />
        ))}
      </IconBase>
    );
  }

  // Weights the library does not offer still type-check and still render: light
  // was the step below regular, sharp a second cut of it.
  const resolved = weight === "light" ? "thin" : weight === "sharp" ? "regular" : weight;

  const width =
    resolved === "duotone"
      ? STROKE_WIDTHS.regular
      : STROKE_WIDTHS[resolved as keyof typeof STROKE_WIDTHS] ?? STROKE_WIDTHS.regular;

  const strokes = paths.map((path, i) => (
    <path
      key={`s${i}`}
      d={path}
      fill="none"
      stroke={color}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ));

  if (weight === "duotone") {
    return (
      <IconBase {...props} color={color}>
        {paths.map((path, i) => (
          <path key={`f${i}`} d={path} opacity={0.2} />
        ))}
        {strokes}
      </IconBase>
    );
  }

  return (
    <IconBase {...props} color={color} fill="none">
      {strokes}
    </IconBase>
  );
}
