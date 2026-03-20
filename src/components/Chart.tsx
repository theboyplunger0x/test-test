"use client";

import { useEffect, useRef } from "react";
import {
  createChart, IChartApi,
  CandlestickSeries, LineSeries,
  ISeriesApi, SeriesType,
} from "lightweight-charts";
import type { Candle } from "@/lib/chartData";

interface Props {
  candles: Candle[];
  type?: "candles" | "line";
  entryPrice?: number;
  direction?: "long" | "short" | null;
  dk?: boolean;
}

export default function Chart({ candles, type = "candles", entryPrice, direction, dk = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef     = useRef<IChartApi | null>(null);
  const seriesRef    = useRef<ISeriesApi<SeriesType> | null>(null);
  const candlesRef   = useRef<Candle[]>(candles);
  candlesRef.current = candles;

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
        vertLines: { color: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)" },
        horzLines: { color: dk ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.05)" },
      },
      crosshair: {
        vertLine: { color: dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", labelBackgroundColor: dk ? "#1a1a1a" : "#f5f5f5" },
        horzLine: { color: dk ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)", labelBackgroundColor: dk ? "#1a1a1a" : "#f5f5f5" },
      },
      rightPriceScale: {
        borderColor: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: dk ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.08)",
        timeVisible: true,
        secondsVisible: false,
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
    });

    chartRef.current = chart;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; seriesRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dk]);

  // Swap series when type changes, re-apply current candles
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (type === "candles") {
      seriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor:        "#22c55e",
        downColor:      "#ef4444",
        borderUpColor:  "#22c55e",
        borderDownColor:"#ef4444",
        wickUpColor:    "#22c55e",
        wickDownColor:  "#ef4444",
      });
    } else {
      seriesRef.current = chart.addSeries(LineSeries, {
        color:            "#22c55e",
        lineWidth:        2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
    }

    if (candlesRef.current.length > 0) {
      const deduped = candlesRef.current
        .slice()
        .sort((a, b) => a.time - b.time)
        .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
      const data = type === "line"
        ? deduped.map((c) => ({ time: c.time, value: c.close }))
        : deduped;
      seriesRef.current.setData(data as any);
      chart.timeScale().fitContent();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  // Update data when candles change (no series recreation)
  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;
    const deduped = candles
      .slice()
      .sort((a, b) => a.time - b.time)
      .filter((c, i, arr) => i === 0 || c.time !== arr[i - 1].time);
    const data = type === "line"
      ? deduped.map((c) => ({ time: c.time, value: c.close }))
      : deduped;
    seriesRef.current.setData(data as any);
    chartRef.current?.timeScale().fitContent();
  }, [candles, type]);

  // Entry price horizontal line
  useEffect(() => {
    if (!seriesRef.current || !entryPrice) return;
    const color = direction === "short" ? "#ef4444" : "#22c55e";
    const priceLine = seriesRef.current.createPriceLine({
      price: entryPrice,
      color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: direction === "short" ? "▼ ENTRY" : "▲ ENTRY",
    });
    return () => { try { seriesRef.current?.removePriceLine(priceLine); } catch {} };
  }, [entryPrice, direction]);

  return <div ref={containerRef} className="w-full h-full" />;
}
