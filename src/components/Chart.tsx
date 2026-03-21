"use client";

import { useEffect, useRef } from "react";
import { createChart, IChartApi, AreaSeries, ISeriesApi, SeriesType } from "lightweight-charts";
import type { Candle } from "@/lib/chartData";

interface Props {
  candles: Candle[];
  livePrice?: number;   // updated every 5s — only updates last point, no full re-render
  entryPrice?: number;
  direction?: "long" | "short" | null;
  dk?: boolean;
}

// Handles meme coin prices like 0.000000042 correctly
function fmtPrice(n: number): string {
  if (n === 0) return "0";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.0001) return n.toFixed(6);
  return n.toPrecision(4);
}

// How many candles to keep visible (fills chart without cramming all history)
const VISIBLE_CANDLES = 40;

export default function Chart({ candles, livePrice, entryPrice, direction, dk = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<SeriesType> | null>(null);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: dk ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.4)",
        fontSize: 11,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: dk ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)" },
      },
      crosshair: {
        vertLine: {
          color: dk ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
          labelBackgroundColor: dk ? "#1a1a1a" : "#f0f0f0",
        },
        horzLine: {
          color: dk ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
          labelBackgroundColor: dk ? "#1a1a1a" : "#f0f0f0",
        },
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.1 },
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
      },
      // Locked — no zoom, no scroll (Polymarket style)
      handleScroll: false,
      handleScale: false,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      localization: {
        priceFormatter: fmtPrice,
      },
    });

    chartRef.current = chart;

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#f97316",
      topColor: "rgba(249,115,22,0.18)",
      bottomColor: "rgba(249,115,22,0)",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBackgroundColor: "#f97316",
    });
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (!containerRef.current) return;
      chart.applyOptions({
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dk]);

  // Set data and zoom to the most recent VISIBLE_CANDLES
  useEffect(() => {
    if (!seriesRef.current || !chartRef.current || candles.length === 0) return;

    const deduped = candles
      .slice()
      .sort((a, b) => (a.time as number) - (b.time as number))
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);

    const data = deduped.map((c) => ({ time: c.time, value: c.close }));
    seriesRef.current.setData(data as any);

    // Zoom so movement fills the chart instead of looking like a worm
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: Math.max(0, data.length - VISIBLE_CANDLES),
      to: data.length,
    });
  }, [candles]);

  // Live price — update only the last data point (no full re-render, no flicker)
  useEffect(() => {
    if (!seriesRef.current || !livePrice || candles.length === 0) return;
    const lastCandle = candles[candles.length - 1];
    seriesRef.current.update({ time: lastCandle.time, value: livePrice } as any);
  }, [livePrice, candles]);

  // Entry price dashed horizontal line ("Price to beat")
  useEffect(() => {
    if (!seriesRef.current || !entryPrice) return;
    const color = direction === "short" ? "#ef4444" : "#22c55e";
    const priceLine = seriesRef.current.createPriceLine({
      price: entryPrice,
      color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: ">>> PRICE TO BEAT <<<",
    });
    return () => { try { seriesRef.current?.removePriceLine(priceLine); } catch {} };
  }, [entryPrice, direction]);

  return <div ref={containerRef} className="w-full h-full" />;
}
