"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const AXIS = { fontSize: 11, fill: "#667085" };
const money = (n: number) => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
const tip = { contentStyle: { borderRadius: 8, border: "1px solid #e4e7ec", fontSize: 12, boxShadow: "0 4px 12px rgba(16,24,40,.08)" } };

export function PipelineChart({ data }: { data: { stage: string; value: number; count: number; atRisk: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="stage" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} />
        <Tooltip {...tip} cursor={{ fill: "#f4f5f7" }} formatter={(v, name) => [money(Number(v)), name === "atRisk" ? "At risk" : "On track"]} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.count ?? 0} POs`} />
        <Bar dataKey="value" stackId="a" fill="#0c1322" radius={[0, 0, 0, 0]} name="value" />
        <Bar dataKey="atRisk" stackId="a" fill="#d6202a" radius={[4, 4, 0, 0]} name="atRisk" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function OnTimeChart({ data }: { data: { month: string; onTime: number | null; orders: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={230}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="month" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <ReferenceLine y={85} stroke="#12b76a" strokeDasharray="4 4" label={{ value: "Target 85%", position: "insideTopRight", fontSize: 10, fill: "#12b76a" }} />
        <Tooltip {...tip} formatter={(v) => [`${v}%`, "Ready on time"]} labelFormatter={(l, p) => `${l} · ${p?.[0]?.payload?.orders ?? 0} orders`} />
        <Line type="monotone" dataKey="onTime" stroke="#0c1322" strokeWidth={2} dot={{ r: 3, fill: "#0c1322" }} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function CashChart({ data }: { data: { week: string; amount: number; held: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
        <CartesianGrid vertical={false} stroke="#eef0f3" />
        <XAxis dataKey="week" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={money} />
        <Tooltip {...tip} cursor={{ fill: "#f4f5f7" }} formatter={(v, name) => [money(Number(v)), name === "held" ? "On hold" : "Payable"]} />
        <Bar dataKey="amount" stackId="a" name="amount">
          {data.map((d, i) => (
            <Cell key={d.week} fill={i === 0 ? "#b54708" : "#475467"} />
          ))}
        </Bar>
        <Bar dataKey="held" stackId="a" fill="#fda29b" name="held" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
