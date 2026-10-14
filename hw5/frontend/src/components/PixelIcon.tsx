interface Props {
  grid: string[];
  color: string;
  size?: number;
  title?: string;
}

export function PixelIcon({ grid, color, size = 28, title }: Props) {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${cols} ${rows}`}
      shapeRendering="crispEdges"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {grid.flatMap((row, y) =>
        [...row].map((ch, x) => (ch === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null)),
      )}
    </svg>
  );
}
