"use client";

import { useMemo, useRef, useState } from "react";
import type { HistoryPoint } from "@/lib/types";

interface ValueHistoryChartProps {
  points: HistoryPoint[];
}

const VIEW_WIDTH = 360;
const VIEW_HEIGHT = 180;
const PADDING = { top: 16, right: 12, bottom: 24, left: 8 };

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ValueHistoryChart({ points }: ValueHistoryChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (points.length < 2) return null;

    const values = points.map((p) => p.totalValue);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    // Financial/value time series are conventionally zoomed to the data's
    // own range (not zero-based) so real fluctuation stays visible instead
    // of flattening into a line near the top of a zero-anchored axis.
    const span = Math.max(rawMax - rawMin, 1);
    const padAmount = niceCeil(span * 0.15);
    const min = Math.max(0, Math.floor(rawMin - padAmount));
    const max = rawMax + padAmount;

    const innerWidth = VIEW_WIDTH - PADDING.left - PADDING.right;
    const innerHeight = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

    const xFor = (i: number) => PADDING.left + (i / (points.length - 1)) * innerWidth;
    const yFor = (v: number) => PADDING.top + innerHeight - ((v - min) / (max - min)) * innerHeight;

    const coords = points.map((p, i) => ({ x: xFor(i), y: yFor(p.totalValue), point: p }));
    const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const baseline = PADDING.top + innerHeight;
    const areaPath = `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${baseline.toFixed(1)} L${coords[0].x.toFixed(1)},${baseline.toFixed(1)} Z`;

    const tickCount = 4;
    const yTicks = Array.from({ length: tickCount + 1 }, (_, i) => min + ((max - min) * i) / tickCount);

    return { coords, linePath, areaPath, yTicks, yFor };
  }, [points]);

  function updateFromClientX(clientX: number) {
    if (!chart || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * VIEW_WIDTH;

    let closest = 0;
    let closestDist = Infinity;
    chart.coords.forEach((c, i) => {
      const dist = Math.abs(c.x - svgX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = i;
      }
    });
    setHoverIndex(closest);
  }

  if (!chart) {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-1 rounded-2xl border border-neutral-200 bg-white text-center text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900">
        <span>Not enough history yet.</span>
        <span className="text-xs">Add or refresh a card to start tracking value over time.</span>
      </div>
    );
  }

  const latest = points[points.length - 1];
  const hovered = hoverIndex != null ? chart.coords[hoverIndex] : null;
  const active = hovered ?? chart.coords[chart.coords.length - 1];
  const endPoint = chart.coords[chart.coords.length - 1];

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium text-neutral-500">Value Over Time</span>
        <span className="text-sm font-semibold">{formatCurrency(latest.totalValue)}</span>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full touch-none select-none"
        onPointerDown={(e) => updateFromClientX(e.clientX)}
        onPointerMove={(e) => updateFromClientX(e.clientX)}
        onPointerUp={() => setHoverIndex(null)}
        onPointerLeave={() => setHoverIndex(null)}
        onPointerCancel={() => setHoverIndex(null)}
      >
        {chart.yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PADDING.left}
              x2={VIEW_WIDTH - PADDING.right}
              y1={chart.yFor(tick)}
              y2={chart.yFor(tick)}
              stroke="currentColor"
              strokeWidth={1}
              className="text-neutral-200 dark:text-neutral-800"
            />
            <text
              x={PADDING.left}
              y={chart.yFor(tick) - 3}
              fontSize={8}
              className="fill-neutral-400 dark:fill-neutral-500"
            >
              {formatCurrency(tick)}
            </text>
          </g>
        ))}

        {/* Series color (this app's brand accent) lives on this <g>; the
            line/area/markers inherit it via currentColor/fill="currentColor". */}
        <g className="text-sky-600 dark:text-sky-400">
          <path d={chart.areaPath} fill="currentColor" opacity={0.1} stroke="none" />
          <path
            d={chart.linePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {/* End marker with a surface-color ring so it stays legible crossing the line */}
          <circle cx={endPoint.x} cy={endPoint.y} r={6} className="fill-white dark:fill-neutral-900" />
          <circle cx={endPoint.x} cy={endPoint.y} r={4} fill="currentColor" />

          {hovered && (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={PADDING.top}
                y2={VIEW_HEIGHT - PADDING.bottom}
                stroke="currentColor"
                strokeWidth={1}
                opacity={0.3}
              />
              <circle cx={hovered.x} cy={hovered.y} r={6} className="fill-white dark:fill-neutral-900" />
              <circle cx={hovered.x} cy={hovered.y} r={4} fill="currentColor" />
            </>
          )}
        </g>

        <text x={PADDING.left} y={VIEW_HEIGHT - 6} fontSize={8} className="fill-neutral-400 dark:fill-neutral-500">
          {formatDate(points[0].date)}
        </text>
        <text
          x={VIEW_WIDTH - PADDING.right}
          y={VIEW_HEIGHT - 6}
          fontSize={8}
          textAnchor="end"
          className="fill-neutral-400 dark:fill-neutral-500"
        >
          {formatDate(points[points.length - 1].date)}
        </text>
      </svg>

      <div className="mt-1 text-center text-xs text-neutral-500">
        {formatDate(active.point.date)}:{" "}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">
          {formatCurrency(active.point.totalValue)}
        </span>
      </div>
    </div>
  );
}
