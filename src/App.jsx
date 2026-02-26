import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"
import {
  Download,
  Undo,
  Redo,
  Trash2,
  Search,
  Code,
  Copy,
  Check,
  X,
  Link2,
} from "lucide-react"

// ---- Constants ----
const GRID_SIZE = 20
const NODE_WIDTH = 140
const NODE_HEIGHT = 60
const DECISION_NODE_WIDTH = 180
const DECISION_NODE_HEIGHT = 100
const CIRCLE_NODE_SIZE = 160
const ROUNDED_RADIUS = 12
const DELETE_TAB_WIDTH = 32
const DELETE_TAB_HEIGHT = 26
const LABEL_WRAP_CHAR_LIMIT = 18
const NODE_LABEL_FONT_SIZE = 14
const NODE_LABEL_LINE_HEIGHT = 16
const NODE_LABEL_CHAR_WIDTH = 8
const NODE_LABEL_PAD_X = 6
const NODE_LABEL_BOX_VERTICAL_PAD = 8
const NODE_CONNECT_ICON_SIZE = 14
const NODE_CONNECT_ICON_GAP = 6
const NODE_TEXT_BLOCK_OUTER_PAD = 8
const NODE_LAYOUT_CHAR_STEP = 4
const DIAMOND_TEXT_EDGE_PAD = 8
const DIAMOND_FIT_RATIO = 0.92
const RESET_ZOOM_TOP_PADDING = 80
const NODE_CONTENT_INSET = 10

const NODE_SHAPES = {
  rounded: { label: "Start/End", mermaid: "()" },
  rectangle: { label: "Process", mermaid: "[]" },
  diamond: { label: "Decision", mermaid: "{}" },
  circle: { label: "Connector", mermaid: "(())" },
  stadium: { label: "Stadium", mermaid: "([])" },
}
const NODE_BASE_LABELS = {
  rectangle: "Process",
  rounded: "Start",
  diamond: "Decision",
  circle: "Connector",
  stadium: "Stadium",
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n))
const snapToGrid = (value) => Math.round(value / GRID_SIZE) * GRID_SIZE
const getShapeSize = (shape) => {
  if (shape === "diamond") return { width: DECISION_NODE_WIDTH, height: DECISION_NODE_HEIGHT }
  if (shape === "circle") return { width: CIRCLE_NODE_SIZE, height: CIRCLE_NODE_SIZE }
  return { width: NODE_WIDTH, height: NODE_HEIGHT }
}
const indexToAlphaId = (index) => {
  let n = Math.max(1, Number(index) || 1)
  let out = ""
  while (n > 0) {
    n -= 1
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26)
  }
  return out
}
const getNextAvailableNodeId = (nodes) => {
  const used = new Set(nodes.map((n) => String(n.id)))
  let next = 1
  while (used.has(indexToAlphaId(next))) next += 1
  return indexToAlphaId(next)
}
const normalizeMermaidLabel = (label) => String(label ?? "")
const autoLayoutByDirection = (nodes, edges, direction) => {
  if (!nodes.length) return nodes
  const dir = String(direction || "TD").toUpperCase()
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const indegree = new Map(nodes.map((n) => [n.id, 0]))
  const children = new Map(nodes.map((n) => [n.id, []]))

  for (const e of edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue
    indegree.set(e.to, (indegree.get(e.to) || 0) + 1)
    children.get(e.from).push(e.to)
  }

  const queue = []
  for (const n of nodes) {
    if ((indegree.get(n.id) || 0) === 0) queue.push(n.id)
  }
  if (!queue.length && nodes[0]) queue.push(nodes[0].id)

  const levelById = new Map()
  for (const id of queue) levelById.set(id, 0)

  const processed = new Set()
  while (queue.length) {
    const id = queue.shift()
    if (processed.has(id)) continue
    processed.add(id)
    const curLevel = levelById.get(id) || 0
    for (const childId of children.get(id) || []) {
      const nextLevel = curLevel + 1
      if (!levelById.has(childId) || nextLevel > levelById.get(childId)) {
        levelById.set(childId, nextLevel)
      }
      const nextIn = (indegree.get(childId) || 0) - 1
      indegree.set(childId, nextIn)
      if (nextIn === 0) queue.push(childId)
    }
  }

  for (const n of nodes) {
    if (!levelById.has(n.id)) levelById.set(n.id, 0)
  }

  const groups = new Map()
  for (const n of nodes) {
    const lv = levelById.get(n.id) || 0
    if (!groups.has(lv)) groups.set(lv, [])
    groups.get(lv).push(n)
  }

  const levels = Array.from(groups.keys()).sort((a, b) => a - b)
  const maxLevel = levels.length ? levels[levels.length - 1] : 0
  const majorGap = 180
  const minorGap = 220
  const originX = 140
  const originY = 120

  return nodes.map((n) => {
    const rawLevel = levelById.get(n.id) || 0
    const level = dir === "BT" || dir === "RL" ? maxLevel - rawLevel : rawLevel
    const row = groups.get(rawLevel) || [n]
    const idx = row.findIndex((r) => r.id === n.id)
    const count = row.length
    const offset = idx - (count - 1) / 2

    let centerX = 0
    let centerY = 0

    if (dir === "LR" || dir === "RL") {
      centerX = snapToGrid(originX + level * majorGap)
      centerY = snapToGrid(originY + offset * minorGap)
    } else {
      centerX = snapToGrid(originX + offset * minorGap)
      centerY = snapToGrid(originY + level * majorGap)
    }

    return {
      ...n,
      x: centerX - n.width / 2,
      y: centerY - n.height / 2,
    }
  })
}
const getWrappedLineCount = (label, maxCharsPerLine = LABEL_WRAP_CHAR_LIMIT) => {
  const text = String(label ?? "")
  if (!text) return 1
  const safeLimit = Math.max(1, maxCharsPerLine)
  return text.split("\n").reduce((count, segment) => {
    const len = segment.length
    return count + Math.max(1, Math.ceil(len / safeLimit))
  }, 0)
}
const getBaseCharsPerLineForShape = (shape) => {
  const base = getShapeSize(shape)
  const baseInnerWidth =
    shape === "circle"
      ? Math.max(44, base.width / 1.25 - NODE_CONTENT_INSET * 2)
      : Math.max(44, base.width - NODE_CONTENT_INSET * 2)
  return Math.max(
    1,
    Math.floor((baseInnerWidth - NODE_LABEL_PAD_X * 2) / NODE_LABEL_CHAR_WIDTH)
  )
}
const getAdaptiveLabelLayout = (label, shape) => {
  const text = String(label ?? "")
  const baseChars = getBaseCharsPerLineForShape(shape)
  const longestSegmentLength = text
    .split("\n")
    .reduce((maxLen, segment) => Math.max(maxLen, segment.length), 0)
  // Start from a tighter fit so short labels don't render as overly wide boxes.
  let charsPerLine = clamp(Math.max(3, longestSegmentLength || 1), 3, baseChars)
  let lineBudget = 1
  let growWidthNext = true
  let renderedLineCount = getWrappedLineCount(text, charsPerLine)
  let guard = 0

  while (renderedLineCount > lineBudget && guard < 512) {
    if (growWidthNext) {
      charsPerLine += NODE_LAYOUT_CHAR_STEP
    } else {
      lineBudget += 1
    }
    growWidthNext = !growWidthNext
    renderedLineCount = getWrappedLineCount(text, charsPerLine)
    guard += 1
  }

  return {
    charsPerLine,
    lineCount: Math.max(1, renderedLineCount),
    chipWidth:
      NODE_LABEL_PAD_X * 2 + Math.max(18, charsPerLine * NODE_LABEL_CHAR_WIDTH),
    labelHeight: Math.max(
      24,
      Math.max(1, renderedLineCount) * NODE_LABEL_LINE_HEIGHT + NODE_LABEL_BOX_VERTICAL_PAD
    ),
  }
}
const canDiamondFitLabel = (nodeWidth, nodeHeight, chipWidth, labelHeight) => {
  const usableHalfW = Math.max(1, nodeWidth / 2 - DIAMOND_TEXT_EDGE_PAD)
  const usableHalfH = Math.max(1, nodeHeight / 2 - DIAMOND_TEXT_EDGE_PAD)
  const halfChip = chipWidth / 2
  const halfLabel = labelHeight / 2

  if (halfChip > usableHalfW || halfLabel > usableHalfH) return false
  return halfChip / usableHalfW + halfLabel / usableHalfH <= DIAMOND_FIT_RATIO
}
const getDiamondRenderChipLayout = (label, nodeWidth, nodeHeight) => {
  let charsPerLine = getBaseCharsPerLineForShape("diamond")
  let lineCount = 1
  let labelHeight = 24
  let maxChipWidth = Math.max(24, nodeWidth - DIAMOND_TEXT_EDGE_PAD * 2)

  for (let i = 0; i < 24; i += 1) {
    lineCount = getWrappedLineCount(label, charsPerLine)
    labelHeight = Math.max(24, lineCount * NODE_LABEL_LINE_HEIGHT + NODE_LABEL_BOX_VERTICAL_PAD)

    const usableHalfW = Math.max(1, nodeWidth / 2 - DIAMOND_TEXT_EDGE_PAD)
    const usableHalfH = Math.max(1, nodeHeight / 2 - DIAMOND_TEXT_EDGE_PAD)
    const halfLabel = labelHeight / 2
    const widthFactor = 1 - halfLabel / usableHalfH
    const allowedHalfW = widthFactor > 0 ? usableHalfW * widthFactor * DIAMOND_FIT_RATIO : 0
    maxChipWidth = Math.max(24, allowedHalfW * 2)

    const nextChars = Math.max(
      1,
      Math.floor((maxChipWidth - NODE_LABEL_PAD_X * 2) / NODE_LABEL_CHAR_WIDTH)
    )
    if (nextChars === charsPerLine) break
    charsPerLine = nextChars
  }

  const desiredChipWidth =
    NODE_LABEL_PAD_X * 2 + Math.max(18, charsPerLine * NODE_LABEL_CHAR_WIDTH)

  return {
    lineCount,
    labelHeight,
    chipWidth: clamp(desiredChipWidth, 24, maxChipWidth),
  }
}
const getNodeSizeForLabel = (label, shape) => {
  const base = getShapeSize(shape)
  const layout = getAdaptiveLabelLayout(label, shape)
  // Include container padding + connector icon block so wrapped labels can grow vertically.
  const desiredHeight =
    layout.labelHeight + NODE_CONNECT_ICON_SIZE + NODE_CONNECT_ICON_GAP + NODE_TEXT_BLOCK_OUTER_PAD * 2

  if (shape === "circle") {
    // Circle uses r = width/2.5 and inner diameter ~= width/1.25; keep it square.
    const neededInner = Math.max(
      layout.chipWidth,
      layout.labelHeight + NODE_CONNECT_ICON_SIZE + NODE_CONNECT_ICON_GAP + NODE_TEXT_BLOCK_OUTER_PAD
    ) + NODE_CONTENT_INSET * 2
    const needed = snapToGrid(neededInner * 1.25)
    const size = Math.max(base.width, needed)
    return { width: size, height: size }
  }
  if (shape === "diamond") {
    let width = Math.max(base.width, snapToGrid(layout.chipWidth + NODE_CONTENT_INSET * 2))
    let height = Math.max(base.height, snapToGrid(desiredHeight))
    let growWidthNext = true
    let guard = 0

    while (!canDiamondFitLabel(width, height, layout.chipWidth, layout.labelHeight) && guard < 200) {
      if (growWidthNext) width = snapToGrid(width + GRID_SIZE)
      else height = snapToGrid(height + GRID_SIZE)
      growWidthNext = !growWidthNext
      guard += 1
    }

    return { width, height }
  }

  return {
    width: Math.max(base.width, snapToGrid(layout.chipWidth + NODE_CONTENT_INSET * 2)),
    height: Math.max(base.height, snapToGrid(desiredHeight)),
  }
}
const getAutoNodeLabel = (shape, nodes) => {
  const base = NODE_BASE_LABELS[shape] || "Node"
  const countForShape = nodes.filter((n) => n.shape === shape).length + 1
  return countForShape === 1 ? base : `${base} ${countForShape}`
}

// ---- Mermaid ----
function inferFlowDirection(nodes, edges) {
  if (edges.length > 0) {
    let sumAbsDx = 0
    let sumAbsDy = 0
    let sumDx = 0
    let sumDy = 0

    for (const edge of edges) {
      const from = getNodeCenter(nodes, edge.from)
      const to = getNodeCenter(nodes, edge.to)
      const dx = to.x - from.x
      const dy = to.y - from.y
      sumAbsDx += Math.abs(dx)
      sumAbsDy += Math.abs(dy)
      sumDx += dx
      sumDy += dy
    }

    if (sumAbsDx >= sumAbsDy) return sumDx >= 0 ? "LR" : "RL"
    return sumDy >= 0 ? "TD" : "BT"
  }

  if (nodes.length > 1) {
    const bounds = computeGraphBounds(nodes, 0)
    return bounds.width >= bounds.height ? "LR" : "TD"
  }

  return "TD"
}

function generateMermaidCode(nodes, edges, directionOverride) {
  const direction = directionOverride || inferFlowDirection(nodes, edges)
  let code = `flowchart ${direction}\n`
  const escapeQuotedLabel = (value) =>
    String(value ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "<br/>")
  const escapeEdgeLabel = (value) =>
    String(value ?? "")
      .replace(/\n/g, " ")
      .replace(/\|/g, "&#124;")
  const shapeText = {
    rectangle: (label) => `["${label}"]`,
    rounded: (label) => `("${label}")`,
    diamond: (label) => `{"${label}"}`,
    circle: (label) => `(("${label}"))`,
    stadium: (label) => `(["${label}"])`,
  }
  const nodeToken = (node) => {
    const mk = shapeText[node.shape] || shapeText.rectangle
    return `${node.id}${mk(escapeQuotedLabel(node.label))}`
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const connectedIds = new Set()

  for (const edge of edges) {
    connectedIds.add(edge.from)
    connectedIds.add(edge.to)
    const fromNode = nodeById.get(edge.from)
    const toNode = nodeById.get(edge.to)
    const fromToken = fromNode ? nodeToken(fromNode) : edge.from
    const toToken = toNode ? nodeToken(toNode) : edge.to
    const arrow = edge.label ? `-->|${escapeEdgeLabel(edge.label)}|` : "-->"
    code += `    ${fromToken} ${arrow} ${toToken}\n`
  }

  // Keep disconnected nodes in the generated code.
  for (const node of nodes) {
    if (connectedIds.has(node.id)) continue
    code += `    ${nodeToken(node)}\n`
  }
  return code
}

/**
 * Parse a constrained Mermaid subset:
 * - flowchart TD
 * - Nodes: ID[Label], ID(Label), ID{Label}, ID((Label)), ID([Label])
 * - Edges: A --> B, A -->|label| B
 */
function parseMermaidCode(code) {
  try {
    const directionMatch = code.match(/^\s*flowchart\s+([A-Za-z]{2})/im)
    const parsedDirection = directionMatch ? directionMatch[1].toUpperCase() : "TD"
    const lines = code
      .split("\n")
      .map((raw, idx) => ({ raw, trimmed: raw.trim(), lineNo: idx + 1 }))
      .filter((l) => l.trimmed && !l.trimmed.toLowerCase().startsWith("flowchart"))

    const nodes = []
    const edges = []
    let maxEdgeId = 0
    const modernShapeMap = {
      rect: "rectangle",
      rounded: "rounded",
      diam: "diamond",
      diamond: "diamond",
      circle: "circle",
      stadium: "stadium",
    }
    const unescapeAttrValue = (value) =>
      String(value ?? "")
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, "\"")
        .replace(/\\'/g, "'")
        .replace(/\\\\/g, "\\")
    const decodeMermaidLabel = (value) =>
      String(value ?? "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/&#124;/g, "|")
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
    const unquoteLabel = (value) => {
      const raw = String(value ?? "").trim()
      if (
        (raw.startsWith("\"") && raw.endsWith("\"")) ||
        (raw.startsWith("'") && raw.endsWith("'"))
      ) {
        return raw.slice(1, -1)
      }
      return raw
    }

    const parseNodeToken = (token) => {
      const m = String(token)
        .trim()
        .match(/^([A-Za-z0-9_-]+)\s*(\(\(.*\)\)|\(\[.*\]\)|\(.+\)|\{.+\}|\[.+\])?\s*$/)
      if (!m) return null
      const id = m[1]
      const definition = m[2] || null

      if (!definition) return { id }

      let shape = "rectangle"
      if (definition.startsWith("((") && definition.endsWith("))")) shape = "circle"
      else if (definition.startsWith("([") && definition.endsWith("])")) shape = "stadium"
      else if (definition.startsWith("(") && definition.endsWith(")")) shape = "rounded"
      else if (definition.startsWith("{") && definition.endsWith("}")) shape = "diamond"
      else if (definition.startsWith("[") && definition.endsWith("]")) shape = "rectangle"

      const label = definition
        .replace(/^\(\(\s*/, "")
        .replace(/\s*\)\)$/, "")
        .replace(/^\(\[\s*/, "")
        .replace(/\s*\]\)$/, "")
        .replace(/^\(\s*/, "")
        .replace(/\s*\)$/, "")
        .replace(/^\{\s*/, "")
        .replace(/\s*\}$/, "")
        .replace(/^\[\s*/, "")
        .replace(/\s*\]$/, "")

      return { id, shape, label: normalizeMermaidLabel(decodeMermaidLabel(unquoteLabel(label))) }
    }

    const parseModernNodeToken = (token) => {
      const m = String(token)
        .trim()
        .match(/^([A-Za-z0-9_-]+)\s*@\{\s*(.+)\s*\}\s*$/)
      if (!m) return null

      const id = m[1]
      const attrsStr = m[2]
      const attrs = {}
      const attrRegex =
        /([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^,]+)\s*(?:,|$)/g
      let match
      while ((match = attrRegex.exec(attrsStr)) !== null) {
        const key = match[1].toLowerCase()
        let raw = match[2].trim()
        if (
          (raw.startsWith("\"") && raw.endsWith("\"")) ||
          (raw.startsWith("'") && raw.endsWith("'"))
        ) {
          raw = raw.slice(1, -1)
        }
        attrs[key] = unescapeAttrValue(raw)
      }

      const shapeKey = String(attrs.shape || "rect").toLowerCase()
      const shape = modernShapeMap[shapeKey] || "rectangle"
      const label = attrs.label != null ? normalizeMermaidLabel(decodeMermaidLabel(String(attrs.label))) : id
      return { id, shape, label }
    }

    const upsertParsedNode = (parsed) => {
      if (!parsed) return null
      const existing = nodes.find((n) => n.id === parsed.id)
      if (existing) {
        if (parsed.shape) {
          const { width, height } = getShapeSize(parsed.shape)
          existing.shape = parsed.shape
          existing.width = width
          existing.height = height
        }
        if (parsed.label != null) existing.label = parsed.label
        return parsed.id
      }

      const shape = parsed.shape || "rectangle"
      const label = parsed.label != null ? normalizeMermaidLabel(parsed.label) : parsed.id
      const { width, height } = getShapeSize(shape)
      nodes.push({
        id: parsed.id,
        x: 100 + (nodes.length % 4) * 200,
        y: 100 + Math.floor(nodes.length / 4) * 150,
        label,
        shape,
        width,
        height,
      })
      return parsed.id
    }

    const upsertNodeFromToken = (token) => {
      const modernParsed = parseModernNodeToken(token)
      if (modernParsed) return upsertParsedNode(modernParsed)
      const parsed = parseNodeToken(token)
      return upsertParsedNode(parsed)
    }

    const addNodeIfMissing = (id) => {
      if (nodes.some((n) => n.id === id)) return
      const { width, height } = getShapeSize("rectangle")
      nodes.push({
        id,
        x: 100 + (nodes.length % 4) * 200,
        y: 100 + Math.floor(nodes.length / 4) * 150,
        label: id,
        shape: "rectangle",
        width,
        height,
      })
    }

    const handled = new Set()

    // Edges first
    for (const lineInfo of lines) {
      const line = lineInfo.trimmed
      const m = line.match(/^(.+?)\s*-->\s*(?:\|([^|]+)\|\s*)?(.+?)\s*$/)
      if (!m) continue
      const [, fromToken, label = "", toToken] = m
      const from = upsertNodeFromToken(fromToken)
      const to = upsertNodeFromToken(toToken)
      if (!from || !to) continue
      maxEdgeId += 1
      edges.push({
        id: `e${maxEdgeId}`,
        from,
        to,
        label: decodeMermaidLabel(label.trim()),
        type: "arrow",
      })
      addNodeIfMissing(from)
      addNodeIfMissing(to)
      handled.add(lineInfo.lineNo)
    }

    // Nodes
    for (const lineInfo of lines) {
      const line = lineInfo.trimmed
      const modern = parseModernNodeToken(line)
      if (modern) {
        upsertParsedNode(modern)
        handled.add(lineInfo.lineNo)
        continue
      }
      const nm = line.match(/^([A-Za-z0-9_-]+)\s*(\(\(.*\)\)|\(\[.*\]\)|\(.+\)|\{.+\}|\[.+\])\s*$/)
      if (!nm) continue
      upsertNodeFromToken(line)
      handled.add(lineInfo.lineNo)
    }

    const ignorable = /^(%%|subgraph\b|end\b|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b)/i
    const unsupported = lines
      .filter((l) => !handled.has(l.lineNo) && !ignorable.test(l.trimmed))
      .map((l) => `${l.lineNo}: ${l.trimmed}`)

    if (unsupported.length) {
      return {
        ok: false,
        error: `Unsupported Mermaid syntax in line(s):\n${unsupported.join("\n")}`,
      }
    }

    if (nodes.length === 0) return { ok: false, error: "No nodes found." }
    const laidOutNodes = autoLayoutByDirection(nodes, edges, parsedDirection)

    return {
      ok: true,
      nodes: laidOutNodes,
      edges,
      flowDirection: parsedDirection,
      nextNodeId: getNextAvailableNodeId(laidOutNodes),
      nextEdgeId: maxEdgeId + 1,
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ---- Geometry helpers ----
function getNodeCenter(nodes, nodeId) {
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) return { x: 0, y: 0 }
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 }
}
function getNodeConnectionPoint(node, toward, outward = 0) {
  if (!node) return { x: toward?.x ?? 0, y: toward?.y ?? 0 }
  const cx = node.x + node.width / 2
  const cy = node.y + node.height / 2
  const vx = (toward?.x ?? cx) - cx
  const vy = (toward?.y ?? cy) - cy
  const len = Math.hypot(vx, vy) || 1
  const ux = vx / len
  const uy = vy / len

  let t = 1
  if (node.shape === "circle") {
    const r = node.width / 2.5
    t = r / len
  } else if (node.shape === "diamond") {
    const hw = node.width / 2
    const hh = node.height / 2
    const denom = Math.abs(vx) / hw + Math.abs(vy) / hh
    t = denom > 0 ? 1 / denom : 0
  } else {
    const hw = node.width / 2
    const hh = node.height / 2
    const denom = Math.max(Math.abs(vx) / hw, Math.abs(vy) / hh)
    t = denom > 0 ? 1 / denom : 0
  }

  return {
    x: cx + vx * t + ux * outward,
    y: cy + vy * t + uy * outward,
  }
}

function rectFromPoints(a, b) {
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x, b.x)
  const y2 = Math.max(a.y, b.y)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, x2, y2 }
}

function rectIntersects(r, n) {
  const nx1 = n.x
  const ny1 = n.y
  const nx2 = n.x + n.width
  const ny2 = n.y + n.height
  return !(nx2 < r.x || nx1 > r.x2 || ny2 < r.y || ny1 > r.y2)
}

function isPointInHoverExitArea(node, p) {
  const pad = DELETE_TAB_WIDTH * 1.5

  if (node.shape === "circle") {
    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    const r = node.width / 2.5 + pad
    const dx = p.x - cx
    const dy = p.y - cy
    return dx * dx + dy * dy <= r * r
  }

  if (node.shape === "diamond") {
    const cx = node.x + node.width / 2
    const cy = node.y + node.height / 2
    const hw = node.width / 2 + pad
    const hh = node.height / 2 + pad
    return Math.abs(p.x - cx) / hw + Math.abs(p.y - cy) / hh <= 1
  }

  // rectangle/rounded/stadium: expanded rect with asymmetric left padding.
  return (
    p.x >= node.x - pad &&
    p.x <= node.x + node.width + pad &&
    p.y >= node.y - pad &&
    p.y <= node.y + node.height + pad
  )
}

function computeGraphBounds(nodes, padding = 60) {
  if (!nodes.length) return { minX: 0, minY: 0, maxX: 1000, maxY: 600, width: 1000, height: 600 }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + n.width)
    maxY = Math.max(maxY, n.y + n.height)
  }
  minX -= padding
  minY -= padding
  maxX += padding
  maxY += padding
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}
function snapNodeTopLeftToCenterGrid(x, y, width, height) {
  return {
    x: snapToGrid(x + width / 2) - width / 2,
    y: snapToGrid(y + height / 2) - height / 2,
  }
}

function buildExportSvgString({ nodes, edges, background = "white" }) {
  const bounds = computeGraphBounds(nodes, 60)
  const w = Math.max(1, Math.ceil(bounds.width))
  const h = Math.max(1, Math.ceil(bounds.height))

  const markerId = "arrowhead"

  const escapeXml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;")

  const nodeSvg = nodes
    .map((node) => {
      const fill = "#f0f9ff"
      const stroke = "#94a3b8"
      const labelX = node.x + node.width / 2
      const labelY = node.y + node.height / 2

      let shapeEl = ""
      if (node.shape === "diamond") {
        const points = `${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y +
          node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y +
          node.height / 2}`
        shapeEl = `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      } else if (node.shape === "circle") {
        const cx = node.x + node.width / 2
        const cy = node.y + node.height / 2
        const r = node.width / 2.5
        shapeEl = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      } else if (node.shape === "stadium") {
        shapeEl = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.height /
          2}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      } else if (node.shape === "rounded") {
        shapeEl = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${ROUNDED_RADIUS}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      } else {
        shapeEl = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      }

      const textEl = `<text x="${labelX}" y="${labelY}" text-anchor="middle" dominant-baseline="middle" fill="#0f172a" font-size="${NODE_LABEL_FONT_SIZE}" font-weight="500" font-family="Segoe UI, system-ui, sans-serif">${escapeXml(
        node.label
      )}</text>`

      return `${shapeEl}${textEl}`
    })
    .join("")

  const edgeSvg = edges
    .map((edge) => {
      const fromNode = nodes.find((n) => n.id === edge.from)
      const toNode = nodes.find((n) => n.id === edge.to)
      const fromCenter = getNodeCenter(nodes, edge.from)
      const toCenter = getNodeCenter(nodes, edge.to)
      const from = fromNode ? getNodeConnectionPoint(fromNode, toCenter, 2) : fromCenter
      const to = toNode ? getNodeConnectionPoint(toNode, fromCenter, 6) : toCenter
      const stroke = "#64748b"

      const line = `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${stroke}" stroke-width="2" marker-end="url(#${markerId})" />`

      if (!edge.label) return line

      const tx = (from.x + to.x) / 2
      const ty = (from.y + to.y) / 2
      const label = escapeXml(edge.label)
      const labelWidth = Math.max(18, String(edge.label).length * 7 + 10)
      const labelHeight = 18
      const bg = `<rect x="${tx - labelWidth / 2}" y="${ty - labelHeight / 2}" width="${labelWidth}" height="${labelHeight}" rx="4" fill="white" />`
      const text = `<text x="${tx}" y="${ty}" text-anchor="middle" dominant-baseline="middle" fill="#334155" font-size="12" font-weight="500" font-family="Segoe UI, system-ui, sans-serif">${label}</text>`

      return `${line}${bg}${text}`
    })
    .join("")

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}">
  <defs>
    <marker id="${markerId}" markerWidth="12" markerHeight="12" refX="10" refY="3" orient="auto" markerUnits="strokeWidth">
      <path d="M0,0 L0,6 L9,3 z" fill="#64748b" />
    </marker>
  </defs>
  <rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${background}" />
  ${edgeSvg}
  ${nodeSvg}
</svg>`
}

// ---- Initial ----
const initialRoundedSize = getShapeSize("rounded")
const initialRectangleSize = getShapeSize("rectangle")
const initialStartPos = snapNodeTopLeftToCenterGrid(100, 100, initialRoundedSize.width, initialRoundedSize.height)
const initialProcessPos = snapNodeTopLeftToCenterGrid(100, 220, initialRectangleSize.width, initialRectangleSize.height)
const initialNodes = [
  {
    id: "A",
    x: initialStartPos.x,
    y: initialStartPos.y,
    label: "Start",
    shape: "rounded",
    width: initialRoundedSize.width,
    height: initialRoundedSize.height,
  },
  {
    id: "B",
    x: initialProcessPos.x,
    y: initialProcessPos.y,
    label: "Process",
    shape: "rectangle",
    width: initialRectangleSize.width,
    height: initialRectangleSize.height,
  },
]
const initialEdges = [{ id: "e1", from: "A", to: "B", label: "", type: "arrow" }]

const initialState = {
  nodes: initialNodes,
  edges: initialEdges,
  flowDirection: "TD",

  // Selection
  selectedNodes: [],
  selectedEdge: null,
  hoveredEdge: null,

  // Tools
  tool: "select", // select | pan

  // Interaction
  connecting: null, // {from, currentX, currentY}
  dragging: null, // {startX,startY, initialPositions: {id:{x,y}} }
  panning: null, // {startX,startY, offsetX, offsetY}
  hoveredNode: null,

  // Box select
  boxSelect: null, // {start:{x,y}, current:{x,y}}

  // Palette drag create
  paletteDrag: null, // {shape, clientX, clientY, overCanvas:boolean}

  // View
  viewOffset: { x: 0, y: 0 },
  zoom: 1,

  // History
  history: [{ nodes: initialNodes, edges: initialEdges, flowDirection: "TD" }],
  historyIndex: 0,

  // Code
  mermaidCode: generateMermaidCode(initialNodes, initialEdges, "TD"),
  codeEditMode: false,

  // IDs
  nextNodeId: getNextAvailableNodeId(initialNodes),
  nextEdgeId: 2,

  // Right panel
  codePanelVisible: true,
  codePanelWidth: 400,
  resizing: false,

  // UI
  copySuccess: false,

  // Inline node label edit
  labelEdit: null, // { nodeId, value, initialX, initialY, initialWidth, initialHeight, initialCenterX, initialCenterY }
}

function reducer(state, action) {
  switch (action.type) {
    case "SET_TOOL":
      return { ...state, tool: action.tool }

    case "SET_HOVER":
      return { ...state, hoveredNode: action.nodeId }
    case "SET_HOVER_EDGE":
      return { ...state, hoveredEdge: action.edgeId }

    case "SET_ZOOM":
      return { ...state, zoom: clamp(action.zoom, 0.5, 2) }

    case "SET_SELECTION":
      return { ...state, selectedNodes: action.selectedNodes, selectedEdge: action.selectedEdge ?? null }

    case "EDGE_SELECT":
      return { ...state, selectedEdge: action.edgeId, selectedNodes: [] }

    case "PAN_START":
      return { ...state, panning: action.panning }
    case "PAN_MOVE":
      return { ...state, viewOffset: action.viewOffset }
    case "SET_VIEW_OFFSET":
      return { ...state, viewOffset: action.viewOffset }
    case "PAN_END":
      return { ...state, panning: null }

    case "DRAG_START":
      return { ...state, dragging: action.dragging }
    case "DRAG_MOVE":
      return {
        ...state,
        nodes: action.nodes,
        flowDirection: inferFlowDirection(action.nodes, state.edges),
      }
    case "DRAG_END":
      return { ...state, dragging: null }

    case "CONNECT_START":
      return { ...state, connecting: action.connecting, selectedEdge: null }
    case "CONNECT_MOVE":
      return { ...state, connecting: { ...state.connecting, currentX: action.x, currentY: action.y } }
    case "CONNECT_END":
      return { ...state, connecting: null }

    case "BOX_SELECT_START":
      return { ...state, boxSelect: { start: action.start, current: action.start } }
    case "BOX_SELECT_MOVE":
      return { ...state, boxSelect: state.boxSelect ? { ...state.boxSelect, current: action.current } : null }
    case "BOX_SELECT_END":
      return { ...state, boxSelect: null }

    case "PALETTE_DRAG_START":
      return { ...state, paletteDrag: action.payload }
    case "PALETTE_DRAG_MOVE":
      return { ...state, paletteDrag: state.paletteDrag ? { ...state.paletteDrag, ...action.payload } : null }
    case "PALETTE_DRAG_END":
      return { ...state, paletteDrag: null }

    case "SET_CODE_PANEL_VISIBLE":
      return { ...state, codePanelVisible: action.visible }
    case "SET_CODE_PANEL_WIDTH":
      return { ...state, codePanelWidth: action.width }
    case "SET_RESIZING":
      return { ...state, resizing: action.resizing }

    case "SET_MERMAID_CODE":
      return { ...state, mermaidCode: action.code }
    case "SET_CODE_EDIT_MODE":
      return { ...state, codeEditMode: action.enabled }

    case "SET_COPY_SUCCESS":
      return { ...state, copySuccess: action.value }
    case "SET_LABEL_EDIT":
      return { ...state, labelEdit: action.payload }
    case "UPDATE_LABEL_DRAFT":
      if (!state.labelEdit) return state
      {
        const nodeId = state.labelEdit.nodeId
        const existing = state.nodes.find((n) => n.id === nodeId)
        if (!existing) return { ...state, labelEdit: { ...state.labelEdit, value: action.value } }
        const nextSize = getNodeSizeForLabel(action.value, existing.shape)
        const centerX =
          state.labelEdit.initialCenterX ?? snapToGrid(existing.x + existing.width / 2)
        const centerY =
          state.labelEdit.initialCenterY ?? snapToGrid(existing.y + existing.height / 2)
        const nodes =
          nextSize.width === existing.width && nextSize.height === existing.height
            ? state.nodes
            : state.nodes.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      width: nextSize.width,
                      height: nextSize.height,
                      x: centerX - nextSize.width / 2,
                      y: centerY - nextSize.height / 2,
                    }
                  : n
              )
        return { ...state, nodes, labelEdit: { ...state.labelEdit, value: action.value } }
      }
    case "END_LABEL_EDIT":
      return { ...state, labelEdit: null }

    case "APPLY_GRAPH": {
      const { nodes, edges, pushHistory, nextEdgeId, clearSelection, nextFlowDirection } = action
      const computedFlowDirection = nextFlowDirection ?? inferFlowDirection(nodes, edges)
      const base = {
        ...state,
        nodes,
        edges,
        flowDirection: computedFlowDirection,
        nextNodeId: getNextAvailableNodeId(nodes),
        nextEdgeId: nextEdgeId ?? state.nextEdgeId,
      }
      if (!pushHistory) {
        if (clearSelection) return { ...base, selectedNodes: [], selectedEdge: null }
        return base
      }
      const sliced = state.history.slice(0, state.historyIndex + 1)
      const nextHistory = [
        ...sliced,
        { nodes, edges, flowDirection: computedFlowDirection },
      ]
      return {
        ...base,
        history: nextHistory,
        historyIndex: nextHistory.length - 1,
        ...(clearSelection ? { selectedNodes: [], selectedEdge: null } : null),
      }
    }

    case "UNDO": {
      if (state.historyIndex <= 0) return state
      const prev = state.history[state.historyIndex - 1]
      return {
        ...state,
        nodes: prev.nodes,
        edges: prev.edges,
        flowDirection: prev.flowDirection ?? state.flowDirection,
        nextNodeId: getNextAvailableNodeId(prev.nodes),
        historyIndex: state.historyIndex - 1,
        selectedNodes: [],
        selectedEdge: null,
      }
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state
      const next = state.history[state.historyIndex + 1]
      return {
        ...state,
        nodes: next.nodes,
        edges: next.edges,
        flowDirection: next.flowDirection ?? state.flowDirection,
        nextNodeId: getNextAvailableNodeId(next.nodes),
        historyIndex: state.historyIndex + 1,
        selectedNodes: [],
        selectedEdge: null,
      }
    }

    default:
      return state
  }
}

function ShapePreview({ shape }) {
  // A tiny SVG icon-like preview
  const w = 44
  const h = 28
  const fill = "#f8fafc"
  const stroke = "#94a3b8"

  if (shape === "diamond") {
    const pts = `${w / 2},2 ${w - 2},${h / 2} ${w / 2},${h - 2} 2,${h / 2}`
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <polygon points={pts} fill={fill} stroke={stroke} strokeWidth="2" />
      </svg>
    )
  }
  if (shape === "circle") {
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <circle cx={w / 2} cy={h / 2} r={h / 2 - 2} fill={fill} stroke={stroke} strokeWidth="2" />
      </svg>
    )
  }
  if (shape === "stadium") {
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <rect x="2" y="2" width={w - 4} height={h - 4} rx={(h - 4) / 2} fill={fill} stroke={stroke} strokeWidth="2" />
      </svg>
    )
  }
  if (shape === "rounded") {
    return (
      <svg width={w} height={h} style={{ display: "block" }}>
        <rect x="2" y="2" width={w - 4} height={h - 4} rx="8" fill={fill} stroke={stroke} strokeWidth="2" />
      </svg>
    )
  }
  // rectangle
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <rect x="2" y="2" width={w - 4} height={h - 4} fill={fill} stroke={stroke} strokeWidth="2" />
    </svg>
  )
}

export default function MermaidEditor() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [isInstructionsOpen, setIsInstructionsOpen] = useState(false)
  const [edgeLabelEdit, setEdgeLabelEdit] = useState(null) // { edgeId, width }
  const svgRef = useRef(null)
  const canvasRef = useRef(null)
  const labelInputRef = useRef(null)
  const edgeLabelInputRef = useRef(null)
  const edgeLabelDraftRef = useRef("")
  const edgeLabelCommitLockRef = useRef(false)
  const lastLabelEditNodeIdRef = useRef(null)
  const lastEdgeLabelEditIdRef = useRef(null)
  const pendingConnectRef = useRef(null) // { nodeId, startX, startY }
  const didInitialViewportSyncRef = useRef(false)
  const boxSelectRef = useRef(state.boxSelect)
  const selectedNodesRef = useRef(state.selectedNodes)
  const skipNextCodeSyncRef = useRef(false)
  const codeEditStartRef = useRef(null)
  const usageInstructions = useMemo(
    () => [
      {
        lead: "Create a node",
        detail: "Drag a shape from the left panel and drop it on the canvas.",
      },
      {
        lead: "Move one or many nodes",
        detail: "Select nodes, then drag any selected node to move the full selection.",
      },
      {
        lead: "Connect nodes",
        detail: "Hover a node, drag from its highlighted text area, and release on a target node.",
      },
      {
        lead: "Edit node text",
        detail: "Double-click node text to edit inline. Press Enter or click outside to apply.",
      },
      {
        lead: "Edit line labels",
        detail: "Double-click a connection line to edit its label inline.",
      },
      {
        lead: "Select multiple nodes",
        detail: "Drag on empty canvas to box-select; hold Shift to add more.",
      },
      {
        lead: "Pan the canvas",
        detail: "Hold right-click and drag.",
      },
      {
        lead: "Zoom and center",
        detail:
          "Scroll to zoom. Use Reset zoom for 100% + top-centered view, or Center to recenter at current zoom.",
      },
      {
        lead: "Delete and clear",
        detail: "Use node/line delete buttons, press Delete for selected items, or use Clear All in the top bar.",
      },
      {
        lead: "Code editor sync",
        detail: "Edit Mermaid code on the right and click Apply to rebuild the diagram.",
      },
    ],
    []
  )
  const quickUsageInstructions = useMemo(() => usageInstructions.slice(0, 6), [usageInstructions])
  const getEdgeLabelBoxWidth = useCallback(
    (text) => Math.max(26, String(text || "").length * 7 + 10),
    []
  )

  const nodesRef = useRef(state.nodes)
  const edgesRef = useRef(state.edges)
  useEffect(() => {
    nodesRef.current = state.nodes
    edgesRef.current = state.edges
  }, [state.nodes, state.edges])
  useEffect(() => {
    boxSelectRef.current = state.boxSelect
    selectedNodesRef.current = state.selectedNodes
  }, [state.boxSelect, state.selectedNodes])

  const selectedNodesSet = useMemo(() => new Set(state.selectedNodes), [state.selectedNodes])
  const boxPreviewSelectedSet = (() => {
    if (!state.boxSelect) return new Set()
    const r = rectFromPoints(state.boxSelect.start, state.boxSelect.current)
    return new Set(state.nodes.filter((n) => rectIntersects(r, n)).map((n) => n.id))
  })()

  // ---- Keep code synced when not editing ----
  useEffect(() => {
    if (!state.codeEditMode) {
      if (skipNextCodeSyncRef.current) {
        skipNextCodeSyncRef.current = false
        return
      }
      const code = generateMermaidCode(state.nodes, state.edges, state.flowDirection)
      if (code !== state.mermaidCode) dispatch({ type: "SET_MERMAID_CODE", code })
    }
  }, [state.nodes, state.edges, state.codeEditMode, state.flowDirection, state.mermaidCode])

  useEffect(() => {
    if (!state.labelEdit) return
    if (lastLabelEditNodeIdRef.current === state.labelEdit.nodeId) return
    if (!labelInputRef.current) return
    lastLabelEditNodeIdRef.current = state.labelEdit.nodeId
    const el = labelInputRef.current
    if (el.isContentEditable) {
      el.textContent = state.labelEdit.value || ""
    }
    el.focus()
    // Select all text for quick overwrite when edit mode starts.
    if (typeof el.select === "function") {
      el.select()
      return
    }
    const sel = window.getSelection?.()
    if (!sel) return
    const range = document.createRange()
    range.selectNodeContents(el)
    sel.removeAllRanges()
    sel.addRange(range)
  }, [state.labelEdit])

  useEffect(() => {
    if (state.labelEdit) return
    lastLabelEditNodeIdRef.current = null
  }, [state.labelEdit])

  useEffect(() => {
    if (!edgeLabelEdit) return
    if (lastEdgeLabelEditIdRef.current === edgeLabelEdit.edgeId) return
    if (!edgeLabelInputRef.current) return
    lastEdgeLabelEditIdRef.current = edgeLabelEdit.edgeId
    const el = edgeLabelInputRef.current
    if (el.isContentEditable) {
      el.textContent = edgeLabelDraftRef.current || ""
    }
    el.focus()
    const selection = window.getSelection?.()
    if (!selection) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [edgeLabelEdit])

  useEffect(() => {
    if (edgeLabelEdit) return
    lastEdgeLabelEditIdRef.current = null
  }, [edgeLabelEdit])

  const commitEdgeLabelEdit = useCallback(() => {
    if (!edgeLabelEdit || edgeLabelCommitLockRef.current) return
    edgeLabelCommitLockRef.current = true
    const nextLabel = String(edgeLabelDraftRef.current ?? "").trim()
    const currentEdge = state.edges.find((ed) => ed.id === edgeLabelEdit.edgeId)
    if (!currentEdge) {
      setEdgeLabelEdit(null)
      window.setTimeout(() => {
        edgeLabelCommitLockRef.current = false
      }, 0)
      return
    }
    if (nextLabel === String(currentEdge.label ?? "").trim()) {
      dispatch({ type: "EDGE_SELECT", edgeId: edgeLabelEdit.edgeId })
      setEdgeLabelEdit(null)
      window.setTimeout(() => {
        edgeLabelCommitLockRef.current = false
      }, 0)
      return
    }
    const edges = state.edges.map((ed) =>
      ed.id === edgeLabelEdit.edgeId ? { ...ed, label: nextLabel } : ed
    )
    dispatch({
      type: "APPLY_GRAPH",
      nodes: state.nodes,
      edges,
      pushHistory: true,
    })
    dispatch({ type: "EDGE_SELECT", edgeId: edgeLabelEdit.edgeId })
    setEdgeLabelEdit(null)
    window.setTimeout(() => {
      edgeLabelCommitLockRef.current = false
    }, 0)
  }, [edgeLabelEdit, state.nodes, state.edges])

  const cancelEdgeLabelEdit = useCallback(() => {
    edgeLabelCommitLockRef.current = false
    setEdgeLabelEdit(null)
  }, [])

  useEffect(() => {
    if (!edgeLabelEdit) return
    const onPointerDownCapture = (e) => {
      const editorEl = edgeLabelInputRef.current
      if (!editorEl) return
      const target = e.target
      if (target && editorEl.contains(target)) return
      commitEdgeLabelEdit()
    }
    window.addEventListener("pointerdown", onPointerDownCapture, true)
    return () => {
      window.removeEventListener("pointerdown", onPointerDownCapture, true)
    }
  }, [edgeLabelEdit, commitEdgeLabelEdit])

  // ---- Keyboard shortcuts ----
  const deleteSelected = useCallback(() => {
    if (state.selectedNodes.length > 0) {
      const toDelete = new Set(state.selectedNodes)
      const nodes = state.nodes.filter((n) => !toDelete.has(n.id))
      const edges = state.edges.filter((e) => !toDelete.has(e.from) && !toDelete.has(e.to))
      dispatch({ type: "APPLY_GRAPH", nodes, edges, pushHistory: true, clearSelection: true })
      return
    }
    if (state.selectedEdge) {
      const edges = state.edges.filter((e) => e.id !== state.selectedEdge)
      dispatch({ type: "APPLY_GRAPH", nodes: state.nodes, edges, pushHistory: true, clearSelection: true })
    }
  }, [state.selectedNodes, state.selectedEdge, state.nodes, state.edges])
  const clearAll = useCallback(() => {
    if (state.nodes.length === 0 && state.edges.length === 0) return
    dispatch({ type: "APPLY_GRAPH", nodes: [], edges: [], pushHistory: true, clearSelection: true })
  }, [state.nodes, state.edges])

  const undo = useCallback(() => dispatch({ type: "UNDO" }), [])
  const redo = useCallback(() => dispatch({ type: "REDO" }), [])

  useEffect(() => {
    const onKeyDown = (e) => {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault()
        undo()
        return
      }
      if (meta && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault()
        redo()
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        const target = e.target
        const tag = (target && target.tagName) || ""
        if (tag.toLowerCase() === "textarea" || tag.toLowerCase() === "input" || target?.isContentEditable) return
        e.preventDefault()
        deleteSelected()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [undo, redo, deleteSelected])

  useEffect(() => {
    if (!isInstructionsOpen) return
    const onEscape = (e) => {
      if (e.key === "Escape") setIsInstructionsOpen(false)
    }
    window.addEventListener("keydown", onEscape)
    return () => window.removeEventListener("keydown", onEscape)
  }, [isInstructionsOpen])

  useEffect(() => {
    const isInteracting = Boolean(
      state.dragging || state.boxSelect || state.panning || state.connecting || state.paletteDrag
    )
    if (!isInteracting || state.labelEdit) return

    const bodyStyle = document.body.style
    const docStyle = document.documentElement.style
    const prevBodyUserSelect = bodyStyle.userSelect
    const prevBodyWebkitUserSelect = bodyStyle.webkitUserSelect
    const prevDocUserSelect = docStyle.userSelect
    const prevDocWebkitUserSelect = docStyle.webkitUserSelect

    bodyStyle.userSelect = "none"
    bodyStyle.webkitUserSelect = "none"
    docStyle.userSelect = "none"
    docStyle.webkitUserSelect = "none"

    return () => {
      bodyStyle.userSelect = prevBodyUserSelect
      bodyStyle.webkitUserSelect = prevBodyWebkitUserSelect
      docStyle.userSelect = prevDocUserSelect
      docStyle.webkitUserSelect = prevDocWebkitUserSelect
    }
  }, [state.dragging, state.boxSelect, state.panning, state.connecting, state.paletteDrag, state.labelEdit])

  // ---- Coordinate conversion ----
  const clientToWorld = useCallback(
    (clientX, clientY) => {
      if (!svgRef.current) return { x: 0, y: 0 }
      const rect = svgRef.current.getBoundingClientRect()
      const x = (clientX - rect.left - state.viewOffset.x) / state.zoom
      const y = (clientY - rect.top - state.viewOffset.y) / state.zoom
      return { x, y }
    },
    [state.viewOffset, state.zoom]
  )

  // ---- Palette drag-to-create ----
  const onPalettePointerDown = useCallback((e, shape) => {
    e.preventDefault()
    e.stopPropagation();
    (e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId)) || undefined
    dispatch({
      type: "PALETTE_DRAG_START",
      payload: { shape, clientX: e.clientX, clientY: e.clientY, overCanvas: false },
    })
  }, [])

  // Global move/up handlers for palette drag
  useEffect(() => {
    if (!state.paletteDrag) return
    const dragShape = state.paletteDrag.shape

    const onMove = (e) => {
      const canvasEl = canvasRef.current
      let overCanvas = false
      if (canvasEl) {
        const r = canvasEl.getBoundingClientRect()
        overCanvas = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      }
      dispatch({ type: "PALETTE_DRAG_MOVE", payload: { clientX: e.clientX, clientY: e.clientY, overCanvas } })
    }

    const onUp = (e) => {
      dispatch({ type: "PALETTE_DRAG_END" })

      // Create only if dropped over canvas
      const canvasEl = canvasRef.current
      if (!canvasEl) return
      const r = canvasEl.getBoundingClientRect()
      const overCanvas = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
      if (!overCanvas) return

      const world = clientToWorld(e.clientX, e.clientY)
      const id = String(state.nextNodeId)
      const { width, height } = getShapeSize(dragShape)
      const label = getAutoNodeLabel(dragShape, nodesRef.current)
      const snappedCenterX = snapToGrid(world.x)
      const snappedCenterY = snapToGrid(world.y)
      const newNode = {
        id,
        x: snappedCenterX - width / 2,
        y: snappedCenterY - height / 2,
        label,
        shape: dragShape,
        width,
        height,
      }

      const nodes = [...nodesRef.current, newNode]
      dispatch({ type: "APPLY_GRAPH", nodes, edges: edgesRef.current, pushHistory: true, clearSelection: true })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [state.paletteDrag, clientToWorld, state.nextNodeId])

  useEffect(() => {
    if (!state.boxSelect) return

    const onMove = (e) => {
      const current = clientToWorld(e.clientX, e.clientY)
      dispatch({ type: "BOX_SELECT_MOVE", current })
    }

    const onUp = (e) => {
      const active = boxSelectRef.current
      if (!active) return
      const r = rectFromPoints(active.start, active.current)
      const hits = nodesRef.current.filter((n) => rectIntersects(r, n)).map((n) => n.id)
      const union = (prev, add) => {
        const s = new Set(prev)
        for (const id of add) s.add(id)
        return Array.from(s)
      }
      const next = e.shiftKey ? union(selectedNodesRef.current, hits) : hits
      dispatch({ type: "SET_SELECTION", selectedNodes: next, selectedEdge: null })
      dispatch({ type: "BOX_SELECT_END" })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [state.boxSelect, clientToWorld])

  useEffect(() => {
    if (!state.dragging) return

    const dragging = state.dragging
    const zoom = state.zoom

    const onMove = (e) => {
      const dx = (e.clientX - dragging.startX) / zoom
      const dy = (e.clientY - dragging.startY) / zoom
      const newNodes = nodesRef.current.map((n) => {
        const p = dragging.initialPositions?.[n.id]
        if (!p) return n
        const centerX = p.x + n.width / 2 + dx
        const centerY = p.y + n.height / 2 + dy
        return {
          ...n,
          x: snapToGrid(centerX) - n.width / 2,
          y: snapToGrid(centerY) - n.height / 2,
        }
      })
      dispatch({ type: "DRAG_MOVE", nodes: newNodes })
    }

    const onUp = () => {
      dispatch({ type: "APPLY_GRAPH", nodes: nodesRef.current, edges: edgesRef.current, pushHistory: true })
      dispatch({ type: "DRAG_END" })
    }

    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
    }
  }, [state.dragging, state.zoom])

  // ---- Node drag ----
  const startDragging = useCallback(
    (e, node) => {
      if (e.button !== 0) return
      e.stopPropagation()
      if (state.tool !== "select") return
      if (state.connecting || state.paletteDrag) return

      const nextSelected = (() => {
        if (e.shiftKey) {
          if (selectedNodesSet.has(node.id)) return state.selectedNodes
          return [...state.selectedNodes, node.id]
        }
        if (selectedNodesSet.has(node.id) && state.selectedNodes.length > 1) {
          return state.selectedNodes
        }
        return [node.id]
      })()

      const initialPositions = Object.fromEntries(
        state.nodes
          .filter((n) => nextSelected.includes(n.id))
          .map((n) => [n.id, { x: n.x, y: n.y }])
      )

      dispatch({ type: "SET_SELECTION", selectedNodes: nextSelected, selectedEdge: null })
      dispatch({ type: "DRAG_START", dragging: { startX: e.clientX, startY: e.clientY, initialPositions } })
    },
    [state.tool, state.connecting, state.paletteDrag, state.selectedNodes, state.nodes, selectedNodesSet]
  )

  // ---- Connecting ----
  const startConnectIntent = useCallback(
    (e, node) => {
      if (e.button !== 0) return
      e.stopPropagation()
      if (state.paletteDrag || state.boxSelect || state.dragging || state.panning) return
      pendingConnectRef.current = { nodeId: node.id, startX: e.clientX, startY: e.clientY }
    },
    [state.paletteDrag, state.boxSelect, state.dragging, state.panning]
  )

  // ---- Canvas mouse down (pan / box select / clear) ----
  const handleCanvasPointerDown = useCallback(
    (e) => {
      if (state.resizing) return
      if (state.paletteDrag) return

      // Right-click pans regardless of active tool.
      if (e.button === 2) {
        e.preventDefault()
        dispatch({ type: "PAN_START", panning: { startX: e.clientX, startY: e.clientY, offsetX: state.viewOffset.x, offsetY: state.viewOffset.y } })
        return
      }

      if (state.tool === "pan") {
        dispatch({ type: "PAN_START", panning: { startX: e.clientX, startY: e.clientY, offsetX: state.viewOffset.x, offsetY: state.viewOffset.y } })
        return
      }

      // Select tool: start box-select if clicking empty canvas (not node/edge)
      const hitNode = e.target.closest?.("[data-node-id]")
      const hitEdge = e.target.closest?.("[data-edge-id]")
      if (!hitNode && !hitEdge) {
        e.preventDefault()
        const start = clientToWorld(e.clientX, e.clientY)
        dispatch({ type: "BOX_SELECT_START", start })
        // Clear previous selection unless shift held
        if (!e.shiftKey) dispatch({ type: "SET_SELECTION", selectedNodes: [], selectedEdge: null })
      }
    },
    [state.tool, state.viewOffset, state.resizing, state.paletteDrag, clientToWorld]
  )

  // ---- Move ----
  const handlePointerMove = useCallback(
    (e) => {
      if (pendingConnectRef.current && !state.connecting && !state.dragging && !state.panning && !state.boxSelect) {
        const intent = pendingConnectRef.current
        const dx = e.clientX - intent.startX
        const dy = e.clientY - intent.startY
        const dragDist = Math.hypot(dx, dy)
        if (dragDist >= 6) {
          const p = clientToWorld(e.clientX, e.clientY)
          dispatch({
            type: "CONNECT_START",
            connecting: { from: intent.nodeId, currentX: p.x, currentY: p.y },
          })
          pendingConnectRef.current = null
        }
      }

      if (state.dragging) return

      if (state.panning) {
        const dx = e.clientX - state.panning.startX
        const dy = e.clientY - state.panning.startY
        dispatch({ type: "PAN_MOVE", viewOffset: { x: state.panning.offsetX + dx, y: state.panning.offsetY + dy } })
        return
      }

      if (state.connecting) {
        const p = clientToWorld(e.clientX, e.clientY)
        dispatch({ type: "CONNECT_MOVE", x: p.x, y: p.y })
        return
      }

      if (state.boxSelect) {
        const current = clientToWorld(e.clientX, e.clientY)
        dispatch({ type: "BOX_SELECT_MOVE", current })
        return
      }

      if (state.hoveredNode) {
        const hovered = state.nodes.find((n) => n.id === state.hoveredNode)
        if (!hovered) {
          dispatch({ type: "SET_HOVER", nodeId: null })
          return
        }
        const p = clientToWorld(e.clientX, e.clientY)
        if (!isPointInHoverExitArea(hovered, p)) {
          dispatch({ type: "SET_HOVER", nodeId: null })
        }
      }
    },
    [state.dragging, state.nodes, state.panning, state.connecting, state.boxSelect, state.hoveredNode, clientToWorld]
  )

  const handleCanvasWheel = useCallback(
    (e) => {
      e.preventDefault()
      if (!svgRef.current) return
      if (state.resizing || state.paletteDrag) return

      const rect = svgRef.current.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const worldX = (mouseX - state.viewOffset.x) / state.zoom
      const worldY = (mouseY - state.viewOffset.y) / state.zoom

      const factor = e.deltaY < 0 ? 1.1 : 0.9
      const nextZoom = clamp(state.zoom * factor, 0.5, 2)
      if (nextZoom === state.zoom) return

      const nextOffset = {
        x: mouseX - worldX * nextZoom,
        y: mouseY - worldY * nextZoom,
      }

      dispatch({ type: "SET_ZOOM", zoom: nextZoom })
      dispatch({ type: "SET_VIEW_OFFSET", viewOffset: nextOffset })
    },
    [state.zoom, state.viewOffset, state.resizing, state.paletteDrag]
  )

  // ---- Up ----
  const handlePointerUp = useCallback(
    (e) => {
      pendingConnectRef.current = null
      if (state.dragging) return

      if (state.connecting) {
        let nodeId = e.target.getAttribute?.("data-node-id")
        if (!nodeId && e.target.closest) {
          const el = e.target.closest("[data-node-id]")
          nodeId = el?.getAttribute("data-node-id") || null
        }

        if (nodeId && nodeId !== state.connecting.from) {
          const from = state.connecting.from
          const to = nodeId
          const exists = state.edges.some((ed) => ed.from === from && ed.to === to)
          if (!exists) {
            const newEdge = { id: `e${state.nextEdgeId}`, from, to, label: "", type: "arrow" }
            const edges = [...state.edges, newEdge]
            dispatch({ type: "APPLY_GRAPH", nodes: state.nodes, edges, pushHistory: true, nextEdgeId: state.nextEdgeId + 1 })
          }
        }

        dispatch({ type: "CONNECT_END" })
        return
      }

      if (state.boxSelect) {
        const r = rectFromPoints(state.boxSelect.start, state.boxSelect.current)
        const hits = state.nodes.filter((n) => rectIntersects(r, n)).map((n) => n.id)
        // If shift is held, union selection; otherwise replace.
        const union = (prev, add) => {
          const s = new Set(prev)
          for (const id of add) s.add(id)
          return Array.from(s)
        }
        const next = e.shiftKey ? union(state.selectedNodes, hits) : hits
        dispatch({ type: "SET_SELECTION", selectedNodes: next, selectedEdge: null })
        dispatch({ type: "BOX_SELECT_END" })
        return
      }

      if (state.panning) {
        if (e.button === 2) e.preventDefault()
        dispatch({ type: "PAN_END" })
      }
    },
    [state.dragging, state.connecting, state.edges, state.nodes, state.nextEdgeId, state.boxSelect, state.selectedNodes, state.panning]
  )

  // ---- Code editing ----
  const handleCodeChange = useCallback((e) => {
    if (!state.codeEditMode && codeEditStartRef.current == null) {
      codeEditStartRef.current = state.mermaidCode
    }
    dispatch({ type: "SET_MERMAID_CODE", code: e.target.value })
    dispatch({ type: "SET_CODE_EDIT_MODE", enabled: true })
  }, [state.codeEditMode, state.mermaidCode])

  const applyCodeChanges = useCallback(() => {
    const res = parseMermaidCode(state.mermaidCode)
    if (!res.ok) return
    // Preserve pasted Mermaid text for this apply cycle.
    skipNextCodeSyncRef.current = true
    dispatch({
      type: "APPLY_GRAPH",
      nodes: res.nodes,
      edges: res.edges,
      pushHistory: true,
      nextNodeId: res.nextNodeId,
      nextEdgeId: res.nextEdgeId,
      nextFlowDirection: res.flowDirection,
      clearSelection: true,
    })
    dispatch({ type: "SET_CODE_EDIT_MODE", enabled: false })
    codeEditStartRef.current = null
  }, [state.mermaidCode])

  const cancelCodeChanges = useCallback(() => {
    const code = codeEditStartRef.current ?? state.mermaidCode
    dispatch({ type: "SET_MERMAID_CODE", code })
    dispatch({ type: "SET_CODE_EDIT_MODE", enabled: false })
    codeEditStartRef.current = null
  }, [state.mermaidCode])

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(state.mermaidCode)
      dispatch({ type: "SET_COPY_SUCCESS", value: true })
      window.setTimeout(() => dispatch({ type: "SET_COPY_SUCCESS", value: false }), 2000)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }, [state.mermaidCode])

  const startLabelEdit = useCallback((node) => {
    dispatch({
      type: "SET_LABEL_EDIT",
      payload: {
        nodeId: node.id,
        value: node.label || "",
        initialX: node.x,
        initialY: node.y,
        initialWidth: node.width,
        initialHeight: node.height,
        initialCenterX: snapToGrid(node.x + node.width / 2),
        initialCenterY: snapToGrid(node.y + node.height / 2),
      },
    })
  }, [])

  const commitLabelEdit = useCallback(() => {
    if (!state.labelEdit) return
    const { nodeId, value, initialCenterX, initialCenterY } = state.labelEdit
    const existing = state.nodes.find((n) => n.id === nodeId)
    if (!existing) {
      dispatch({ type: "END_LABEL_EDIT" })
      return
    }
    const nextLabel = value.trim() || existing.label || `Node ${nodeId}`
    if (nextLabel === existing.label) {
      dispatch({ type: "END_LABEL_EDIT" })
      return
    }
    const nextSize = getNodeSizeForLabel(nextLabel, existing.shape)
    const centerX = initialCenterX ?? snapToGrid(existing.x + existing.width / 2)
    const centerY = initialCenterY ?? snapToGrid(existing.y + existing.height / 2)
    const nodes = state.nodes.map((n) =>
      n.id === nodeId
        ? {
            ...n,
            label: nextLabel,
            width: nextSize.width,
            height: nextSize.height,
            x: centerX - nextSize.width / 2,
            y: centerY - nextSize.height / 2,
          }
        : n
    )
    dispatch({ type: "APPLY_GRAPH", nodes, edges: state.edges, pushHistory: true })
    dispatch({ type: "END_LABEL_EDIT" })
  }, [state.labelEdit, state.nodes, state.edges])

  const cancelLabelEdit = useCallback(() => {
    if (state.labelEdit) {
      const { nodeId, initialX, initialY, initialWidth, initialHeight } = state.labelEdit
      const node = state.nodes.find((n) => n.id === nodeId)
      if (node && (node.x !== initialX || node.y !== initialY || node.width !== initialWidth || node.height !== initialHeight)) {
        const nodes = state.nodes.map((n) =>
          n.id === nodeId ? { ...n, x: initialX, y: initialY, width: initialWidth, height: initialHeight } : n
        )
        dispatch({ type: "APPLY_GRAPH", nodes, edges: state.edges, pushHistory: false })
      }
    }
    dispatch({ type: "END_LABEL_EDIT" })
  }, [state.labelEdit, state.nodes, state.edges])

  const resetZoomAndCenter = useCallback(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) {
      dispatch({ type: "SET_ZOOM", zoom: 1 })
      return
    }

    const canvasRect = canvasEl.getBoundingClientRect()
    const bounds = computeGraphBounds(state.nodes, 0)
    const graphCenterX = bounds.minX + bounds.width / 2

    dispatch({ type: "SET_ZOOM", zoom: 1 })
    dispatch({
      type: "SET_VIEW_OFFSET",
      viewOffset: {
        x: canvasRect.width / 2 - graphCenterX,
        y: RESET_ZOOM_TOP_PADDING - bounds.minY,
      },
    })
  }, [state.nodes])

  const centerDiagram = useCallback(() => {
    const canvasEl = canvasRef.current
    if (!canvasEl) return

    const canvasRect = canvasEl.getBoundingClientRect()
    const bounds = computeGraphBounds(state.nodes, 0)
    const graphCenterX = bounds.minX + bounds.width / 2

    dispatch({
      type: "SET_VIEW_OFFSET",
      viewOffset: {
        x: canvasRect.width / 2 - graphCenterX * state.zoom,
        y: RESET_ZOOM_TOP_PADDING - bounds.minY * state.zoom,
      },
    })
  }, [state.nodes, state.zoom])

  useEffect(() => {
    if (didInitialViewportSyncRef.current) return
    didInitialViewportSyncRef.current = true
    resetZoomAndCenter()
  }, [resetZoomAndCenter])

  // ---- Resize right panel ----
  const startResize = useCallback((e) => {
    e.preventDefault()
    dispatch({ type: "SET_RESIZING", resizing: true })
  }, [])

  useEffect(() => {
    if (!state.resizing) return
    const onMove = (e) => {
      const newWidth = window.innerWidth - e.clientX
      dispatch({ type: "SET_CODE_PANEL_WIDTH", width: clamp(newWidth, 300, 800) })
    }
    const onUp = () => dispatch({ type: "SET_RESIZING", resizing: false })
    document.addEventListener("mousemove", onMove)
    document.addEventListener("mouseup", onUp)
    return () => {
      document.removeEventListener("mousemove", onMove)
      document.removeEventListener("mouseup", onUp)
    }
  }, [state.resizing])

  // ---- Export ----
  const exportAsPNG = useCallback(() => {
    const svgString = buildExportSvgString({ nodes: state.nodes, edges: state.edges, background: "white" })
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const sizeMatch = svgString.match(/width="(\d+)"\s+height="(\d+)"/)
    const baseW = sizeMatch ? Number(sizeMatch[1]) : 1200
    const baseH = sizeMatch ? Number(sizeMatch[2]) : 800
    const scale = 2
    canvas.width = Math.max(1, Math.floor(baseW * scale))
    canvas.height = Math.max(1, Math.floor(baseH * scale))

    const img = new Image()
    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)

    img.onload = () => {
      ctx.fillStyle = "white"
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((png) => {
        if (!png) return
        const a = document.createElement("a")
        a.href = URL.createObjectURL(png)
        a.download = "flowchart.png"
        a.click()
      })
      URL.revokeObjectURL(url)
    }

    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }, [state.nodes, state.edges])

  // ---- Rendering: nodes ----
  const renderNodeShape = useCallback(
    (node) => {
      const isSelected = selectedNodesSet.has(node.id) || boxPreviewSelectedSet.has(node.id)
      const isHovered = state.hoveredNode === node.id && !state.boxSelect
      const isSourceNode = state.connecting?.from === node.id
      const showHoverHighlight = isHovered && (!state.connecting || !isSourceNode)

      const fill = showHoverHighlight ? "#dbeafe" : isSelected ? "#e0f2fe" : "#f0f9ff"
      const stroke = showHoverHighlight ? "#0284c7" : isSelected ? "#0ea5e9" : "#94a3b8"

      const commonProps = {
        "data-node-id": node.id,
        onMouseDown: (e) => startDragging(e, node),
        style: {
          cursor: state.connecting ? "default" : state.tool === "select" ? "move" : "default",
          transition: "fill 100ms ease, stroke 100ms ease",
        },
      }

      const shapeEl = (() => {
        switch (node.shape) {
          case "diamond":
            return (
              <polygon
                points={`${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y +
                  node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y +
                  node.height / 2}`}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                {...commonProps}
              />
            )
          case "circle":
            return (
              <circle
                cx={node.x + node.width / 2}
                cy={node.y + node.height / 2}
                r={node.width / 2.5}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                {...commonProps}
              />
            )
          case "stadium":
            return (
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={node.height / 2}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                {...commonProps}
              />
            )
          case "rounded":
            return (
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={ROUNDED_RADIUS}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                {...commonProps}
              />
            )
          default:
            return (
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                {...commonProps}
              />
            )
        }
      })()

      return <g>{shapeEl}</g>
    },
    [selectedNodesSet, boxPreviewSelectedSet, state.hoveredNode, state.boxSelect, state.tool, state.connecting, startDragging]
  )

  // ---- UI derived ----
  const canUndo = state.historyIndex > 0
  const canRedo = state.historyIndex < state.history.length - 1
  const canDelete = state.selectedNodes.length > 0 || !!state.selectedEdge
  const canClearAll = state.nodes.length > 0 || state.edges.length > 0
  const isZoomDefault = Math.abs(state.zoom - 1) < 0.001

  // ---- Render ----
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif',
        background: "#f8fafc",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          height: "60px",
          background: "white",
          borderBottom: "1px solid #e2e8f0",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          gap: "12px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <h1
          style={{
            fontSize: "20px",
            fontWeight: "700",
            color: "#0f172a",
            margin: 0,
            marginRight: "auto",
            letterSpacing: "-0.5px",
          }}
        >
          Mermaid Flowchart Editor
        </h1>

        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 4px" }} />

        <button
          onClick={undo}
          disabled={!canUndo}
          style={{
            padding: "8px",
            background: "white",
            color: !canUndo ? "#cbd5e1" : "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: !canUndo ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Undo size={16} />
        </button>

        <button
          onClick={redo}
          disabled={!canRedo}
          style={{
            padding: "8px",
            background: "white",
            color: !canRedo ? "#cbd5e1" : "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: !canRedo ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Redo size={16} />
        </button>

        <button
          onClick={deleteSelected}
          disabled={!canDelete}
          style={{
            padding: "8px",
            background: "white",
            color: !canDelete ? "#cbd5e1" : "#ef4444",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: !canDelete ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
          }}
        >
          <Trash2 size={16} />
        </button>
        <button
          onClick={clearAll}
          disabled={!canClearAll}
          style={{
            padding: "8px 12px",
            background: "white",
            color: !canClearAll ? "#cbd5e1" : "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: !canClearAll ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          <Trash2 size={16} />
          Clear All
        </button>

        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 4px" }} />

        <span style={{ fontSize: "14px", color: "#64748b", minWidth: "70px", textAlign: "center", display: "flex", alignItems: "center", gap: "6px", justifyContent: "center" }}>
          <Search size={14} />
          {Math.round(state.zoom * 100)}%
        </span>

        <button
          onClick={resetZoomAndCenter}
          disabled={isZoomDefault}
          style={{
            padding: "8px 12px",
            background: isZoomDefault ? "#f8fafc" : "#0ea5e9",
            color: isZoomDefault ? "#cbd5e1" : "white",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: isZoomDefault ? "not-allowed" : "pointer",
            display: "flex",
            alignItems: "center",
            fontSize: "13px",
            fontWeight: "500",
          }}
        >
          Reset zoom
        </button>
        <button
          onClick={centerDiagram}
          style={{
            padding: "8px 12px",
            background: "white",
            color: "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          Center
        </button>

        <div style={{ width: "1px", height: "24px", background: "#e2e8f0", margin: "0 4px" }} />

        <button
          onClick={exportAsPNG}
          style={{
            padding: "8px 12px",
            background: "#0ea5e9",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          <Download size={16} />
          Export PNG
        </button>

        <button
          onClick={() => dispatch({ type: "SET_CODE_PANEL_VISIBLE", visible: !state.codePanelVisible })}
          style={{
            padding: "8px 12px",
            background: state.codePanelVisible ? "#0ea5e9" : "white",
            color: state.codePanelVisible ? "white" : "#64748b",
            border: "1px solid #e2e8f0",
            borderRadius: "6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            fontSize: "14px",
            fontWeight: "500",
          }}
        >
          <Code size={16} />
          {state.codePanelVisible ? "Hide Code" : "Show Code"}
        </button>
      </div>

      {/* Main Content */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Sidebar - Node Palette */}
        <div
          style={{
            width: "250px",
            background: "white",
            borderRight: "1px solid #e2e8f0",
            padding: "20px",
            overflowY: "auto",
          }}
        >
          <h3
            style={{
              fontSize: "14px",
              fontWeight: "600",
              color: "#0f172a",
              marginTop: 0,
              marginBottom: "16px",
              textTransform: "uppercase",
              letterSpacing: "0.5px",
            }}
          >
            Drag Shapes
          </h3>

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>
            {Object.entries(NODE_SHAPES).map(([key, { label }]) => (
              <div
                key={key}
                onPointerDown={(e) => onPalettePointerDown(e, key)}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "#f8fafc",
                  cursor: "grab",
                  userSelect: "none",
                }}
                title="Click and drag onto the canvas"
              >
                <div style={{ width: 48, display: "flex", justifyContent: "center" }}>
                  <ShapePreview shape={key} />
                </div>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "#334155" }}>{label}</div>
              </div>
            ))}
          </div>

          <div
            onClick={() => setIsInstructionsOpen(true)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                setIsInstructionsOpen(true)
              }
            }}
            style={{
              marginTop: "18px",
              padding: "12px",
              background: "#f1f5f9",
              borderRadius: "10px",
              fontSize: "12px",
              color: "#64748b",
              lineHeight: "1.6",
              cursor: "pointer",
              border: "1px solid #dbeafe",
            }}
            title="Click to open full instructions"
          >
            <strong style={{ color: "#334155", display: "block", marginBottom: "8px" }}>How to use (quick guide):</strong>
            <ol style={{ margin: 0, paddingLeft: "18px" }}>
              {quickUsageInstructions.map((instruction, index) => (
                <li key={index} style={{ marginBottom: "2px" }}>
                  <strong>{instruction.lead}:</strong> <em>{instruction.detail}</em>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: "8px", color: "#475569", fontWeight: 600 }}>
              Click to open the full guide.
            </div>
          </div>
        </div>

        {/* Canvas */}
        <div
          ref={canvasRef}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
            background: "#fafafa",
            backgroundImage: `
              linear-gradient(#e5e7eb 1px, transparent 1px),
              linear-gradient(90deg, #e5e7eb 1px, transparent 1px)
            `,
            backgroundSize: `${GRID_SIZE * state.zoom}px ${GRID_SIZE * state.zoom}px`,
            backgroundPosition: `${state.viewOffset.x}px ${state.viewOffset.y}px`,
            cursor:
              state.panning
                ? "grabbing"
                : state.connecting
                  ? "crosshair"
                  : state.boxSelect
                    ? "crosshair"
                    : "default",
          }}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleCanvasWheel}
          onContextMenu={(e) => e.preventDefault()}
        >
          <svg ref={svgRef} width="100%" height="100%" style={{ position: "absolute", top: 0, left: 0 }}>
            <g transform={`translate(${state.viewOffset.x}, ${state.viewOffset.y}) scale(${state.zoom})`}>
              {/* Edges (with arrow direction) */}
              {state.edges.map((edge) => {
                const fromNode = state.nodes.find((n) => n.id === edge.from)
                const toNode = state.nodes.find((n) => n.id === edge.to)
                const fromCenter = getNodeCenter(state.nodes, edge.from)
                const toCenter = getNodeCenter(state.nodes, edge.to)
                const from = fromNode ? getNodeConnectionPoint(fromNode, toCenter, 2) : fromCenter
                const to = toNode ? getNodeConnectionPoint(toNode, fromCenter, 6) : toCenter
                const isSelected = state.selectedEdge === edge.id
                const isHovered = state.hoveredEdge === edge.id
                const showDelete = isSelected || isHovered
                const lineStroke = isSelected ? "#0ea5e9" : isHovered ? "#38bdf8" : "#64748b"
                const lineWidth = isSelected ? 3 : 2
                const dx = to.x - from.x
                const dy = to.y - from.y
                const isEdgeLabelEditing = edgeLabelEdit?.edgeId === edge.id
                const hasLabelOrEditing = Boolean(edge.label) || isEdgeLabelEditing
                const distributeControlsEvenly = showDelete && hasLabelOrEditing
                const labelT = distributeControlsEvenly ? 1 / 3 : 1 / 2
                const deleteT = distributeControlsEvenly ? 2 / 3 : hasLabelOrEditing ? 0.68 : 0.5
                const labelCenterX = from.x + dx * labelT
                const labelCenterY = from.y + dy * labelT
                const edgeEditorWidth = isEdgeLabelEditing
                  ? edgeLabelEdit.width
                  : getEdgeLabelBoxWidth(edge.label)
                const edgeEditorHeight = 18
                const edgeEditorX = labelCenterX - edgeEditorWidth / 2
                const edgeEditorY = labelCenterY - edgeEditorHeight / 2
                const deleteX = from.x + dx * deleteT
                const deleteY = from.y + dy * deleteT

                return (
                  <g
                    key={edge.id}
                    data-edge-id={edge.id}
                    onPointerEnter={() => dispatch({ type: "SET_HOVER_EDGE", edgeId: edge.id })}
                    onPointerLeave={() => dispatch({ type: "SET_HOVER_EDGE", edgeId: null })}
                  >
                    <defs>
                      <marker
                        id={`arrowhead-${edge.id}`}
                        markerWidth="12"
                        markerHeight="12"
                        refX="10"
                        refY="3"
                        orient="auto"
                        markerUnits="strokeWidth"
                      >
                        <path d="M0,0 L0,6 L9,3 z" fill={lineStroke} />
                      </marker>
                    </defs>
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke="transparent"
                      strokeWidth="20"
                      style={{ cursor: "pointer", pointerEvents: "stroke" }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation()
                        dispatch({ type: "EDGE_SELECT", edgeId: edge.id })
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        dispatch({ type: "EDGE_SELECT", edgeId: edge.id })
                        const initialValue = edge.label || ""
                        edgeLabelDraftRef.current = initialValue
                        setEdgeLabelEdit({ edgeId: edge.id, width: getEdgeLabelBoxWidth(initialValue) })
                      }}
                    />
                    <line
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={lineStroke}
                      strokeWidth={lineWidth}
                      markerEnd={`url(#arrowhead-${edge.id})`}
                      style={{
                        pointerEvents: "none",
                        transition: "stroke 140ms ease",
                      }}
                    />
                    {edge.label && !isEdgeLabelEditing && (
                      <>
                        <rect
                          x={labelCenterX - Math.max(18, String(edge.label).length * 7 + 10) / 2}
                          y={labelCenterY - edgeEditorHeight / 2}
                          width={Math.max(18, String(edge.label).length * 7 + 10)}
                          height={edgeEditorHeight}
                          rx={4}
                          fill="white"
                          style={{ pointerEvents: "none" }}
                        />
                        <text
                          x={labelCenterX}
                          y={labelCenterY}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="#334155"
                          fontSize="12"
                          fontWeight="500"
                          style={{ pointerEvents: "none", userSelect: "none" }}
                        >
                          {edge.label}
                        </text>
                      </>
                    )}
                    {isEdgeLabelEditing && (
                      <foreignObject
                        x={edgeEditorX}
                        y={edgeEditorY}
                        width={edgeEditorWidth}
                        height={edgeEditorHeight}
                      >
                        <div
                          ref={edgeLabelInputRef}
                          contentEditable
                          suppressContentEditableWarning={true}
                          onInput={(e) => {
                            const text = e.currentTarget.textContent || ""
                            edgeLabelDraftRef.current = text
                            const nextWidth = getEdgeLabelBoxWidth(text)
                            setEdgeLabelEdit((prev) =>
                              prev && prev.edgeId === edge.id && prev.width !== nextWidth
                                ? { ...prev, width: nextWidth }
                                : prev
                            )
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          onBlur={commitEdgeLabelEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              commitEdgeLabelEdit()
                              return
                            }
                            if (e.key === "Escape") {
                              e.preventDefault()
                              cancelEdgeLabelEdit()
                            }
                          }}
                          style={{
                            width: "100%",
                            height: "100%",
                            boxSizing: "border-box",
                            border: "1px solid #7dd3fc",
                            borderRadius: "4px",
                            background: "white",
                            color: "#334155",
                            fontSize: "12px",
                            fontWeight: 500,
                            lineHeight: "14px",
                            padding: "0 5px",
                            outline: "none",
                            textAlign: "center",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                          }}
                        />
                      </foreignObject>
                    )}
                    {showDelete && (
                      <g
                        transform={`translate(${deleteX} ${deleteY})`}
                        style={{ cursor: "pointer" }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          const edges = state.edges.filter((ed) => ed.id !== edge.id)
                          dispatch({
                            type: "APPLY_GRAPH",
                            nodes: state.nodes,
                            edges,
                            pushHistory: true,
                            clearSelection: true,
                          })
                        }}
                      >
                        <circle r="10" fill="white" stroke="#ef4444" strokeWidth="1.5" />
                        <foreignObject x="-7" y="-7" width="14" height="14" style={{ pointerEvents: "none" }}>
                          <div style={{ width: "14px", height: "14px", display: "flex", alignItems: "center", justifyContent: "center", color: "#ef4444" }}>
                            <Trash2 size={11} />
                          </div>
                        </foreignObject>
                      </g>
                    )}
                  </g>
                )
              })}

              {/* Nodes */}
              {state.nodes.map((node) => {
                const isHovered = state.hoveredNode === node.id && !state.boxSelect
                const isEditing = state.labelEdit?.nodeId === node.id

                // Connection points visibility rules:
                // - Show on hover when not connecting
                // - While connecting, show only on the source node
                const showConnectHandle = (state.connecting ? state.connecting.from === node.id : isHovered) && !state.boxSelect
                const label = isEditing ? state.labelEdit.value : node.label || ""
                const approxCharWidth = NODE_LABEL_CHAR_WIDTH
                const labelPadX = NODE_LABEL_PAD_X
                const connectIconSize = NODE_CONNECT_ICON_SIZE
                const connectGap = NODE_CONNECT_ICON_GAP
                const labelYOffset = -1
                const showNodeDelete = isHovered && !state.boxSelect
                const deleteTabWidth = DELETE_TAB_WIDTH
                const deleteTabHeight = DELETE_TAB_HEIGHT
                const shapeEdges = (() => {
                  if (node.shape === "circle") {
                    const cx = node.x + node.width / 2
                    const cy = node.y + node.height / 2
                    const r = node.width / 2.5
                    return {
                      left: cx - r,
                      right: cx + r,
                      top: cy - r,
                      bottom: cy + r,
                      centerX: cx,
                      centerY: cy,
                    }
                  }
                  return {
                    left: node.x,
                    right: node.x + node.width,
                    top: node.y,
                    bottom: node.y + node.height,
                    centerX: node.x + node.width / 2,
                    centerY: node.y + node.height / 2,
                  }
                })()
                const deletePos = (() => {
                  // Fixed placement: left side, vertically centered.
                  return { x: shapeEdges.left - deleteTabWidth, y: shapeEdges.centerY - deleteTabHeight / 2 }
                })()
                const deleteX = deletePos.x
                const deleteY = deletePos.y
                const shapeInner = (() => {
                  if (node.shape === "circle") {
                    const cx = node.x + node.width / 2
                    const cy = node.y + node.height / 2
                    const r = node.width / 2.5
                    return {
                      left: cx - r + NODE_CONTENT_INSET,
                      right: cx + r - NODE_CONTENT_INSET,
                      top: cy - r + NODE_CONTENT_INSET,
                      bottom: cy + r - NODE_CONTENT_INSET,
                    }
                  }
                  return {
                    left: node.x + NODE_CONTENT_INSET,
                    right: node.x + node.width - NODE_CONTENT_INSET,
                    top: node.y + NODE_CONTENT_INSET,
                    bottom: node.y + node.height - NODE_CONTENT_INSET,
                  }
                })()
                const maxChipWidth = Math.max(44, shapeInner.right - shapeInner.left)
                const labelLayout =
                  node.shape === "diamond"
                    ? getDiamondRenderChipLayout(label, node.width, node.height)
                    : getAdaptiveLabelLayout(label, node.shape)
                const chipWidth =
                  node.shape === "diamond"
                    ? labelLayout.chipWidth
                    : clamp(labelLayout.chipWidth, 44, maxChipWidth)
                const charsPerLine = Math.max(1, Math.floor((chipWidth - labelPadX * 2) / approxCharWidth))
                const lineCount =
                  node.shape === "diamond"
                    ? labelLayout.lineCount
                    : getWrappedLineCount(label, charsPerLine)
                const labelHeight =
                  node.shape === "diamond"
                    ? labelLayout.labelHeight
                    : Math.max(24, lineCount * NODE_LABEL_LINE_HEIGHT + NODE_LABEL_BOX_VERTICAL_PAD)
                const desiredChipX = node.x + node.width / 2 - chipWidth / 2
                const chipX = clamp(desiredChipX, shapeInner.left, Math.max(shapeInner.left, shapeInner.right - chipWidth))
                const chipY = node.y + node.height / 2 - labelHeight / 2 + labelYOffset
                const iconCenterX = chipX + chipWidth / 2
                const iconCenterY = Math.min(
                  shapeInner.bottom - connectIconSize / 2,
                  chipY + labelHeight + connectGap + connectIconSize / 2
                )

                return (
                  <g
                    key={node.id}
                    data-node-id={node.id}
                    onPointerEnter={() => dispatch({ type: "SET_HOVER", nodeId: node.id })}
                  >
                    {renderNodeShape(node)}
                    {showNodeDelete && (
                      <g
                        transform={`translate(${deleteX} ${deleteY})`}
                        style={{ cursor: "pointer" }}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation()
                          const nodes = state.nodes.filter((n) => n.id !== node.id)
                          const edges = state.edges.filter((ed) => ed.from !== node.id && ed.to !== node.id)
                          dispatch({
                            type: "APPLY_GRAPH",
                            nodes,
                            edges,
                            pushHistory: true,
                            clearSelection: true,
                          })
                        }}
                      >
                        <rect
                          width={deleteTabWidth}
                          height={deleteTabHeight}
                          rx="8"
                          fill="#ef4444"
                        />
                        <foreignObject x="7" y="5" width="18" height="18" style={{ pointerEvents: "none" }}>
                          <div style={{ width: "18px", height: "18px", display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
                            <Trash2 size={14} />
                          </div>
                        </foreignObject>
                      </g>
                    )}

                    <g
                      data-node-id={node.id}
                      onPointerDown={(e) => {
                        if (isEditing) return
                        if (isHovered) startConnectIntent(e, node)
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        pendingConnectRef.current = null
                        startLabelEdit(node)
                      }}
                      style={{
                        cursor:
                          isEditing
                            ? "text"
                            : isHovered || state.connecting?.from === node.id
                              ? "crosshair"
                              : "default",
                      }}
                    >
                      <rect x={chipX} y={chipY} width={chipWidth} height={labelHeight} rx="7" fill="transparent" />
                      {(isHovered || isEditing) && !state.boxSelect && (
                        <rect
                          x={chipX}
                          y={chipY}
                          width={chipWidth}
                          height={labelHeight}
                          rx="7"
                          fill="rgba(255,255,255,0.9)"
                          stroke="#7dd3fc"
                          strokeWidth="1"
                        />
                      )}
                      <foreignObject
                        x={chipX + labelPadX}
                        y={chipY + 3}
                        width={chipWidth - labelPadX * 2}
                        height={labelHeight - 6}
                        style={isEditing ? undefined : { pointerEvents: "none" }}
                      >
                        <div
                          ref={isEditing ? labelInputRef : null}
                          contentEditable={isEditing}
                          suppressContentEditableWarning={true}
                          onInput={
                            isEditing
                              ? (e) => {
                                const el = e.currentTarget
                                const raw = el.textContent || ""
                                const text = raw.slice(0, 80)
                                if (raw !== text) {
                                  // Rewriting textContent can reset caret in contentEditable.
                                  // When enforcing max length, restore caret to the end.
                                  el.textContent = text
                                  const sel = window.getSelection?.()
                                  if (sel) {
                                    const range = document.createRange()
                                    range.selectNodeContents(el)
                                    range.collapse(false)
                                    sel.removeAllRanges()
                                    sel.addRange(range)
                                  }
                                }
                                if (text !== label) {
                                  dispatch({ type: "UPDATE_LABEL_DRAFT", value: text })
                                }
                              }
                              : undefined
                          }
                          onPointerDown={(e) => e.stopPropagation()}
                          onBlur={isEditing ? commitLabelEdit : undefined}
                          onKeyDown={
                            isEditing
                              ? (e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault()
                                  commitLabelEdit()
                                  return
                                }
                                if (e.key === "Escape") {
                                  e.preventDefault()
                                  cancelLabelEdit()
                                }
                              }
                              : undefined
                          }
                          style={{
                            width: "100%",
                            height: "100%",
                            outline: "none",
                            background: "transparent",
                            color: "#0f172a",
                            fontFamily: '"DM Sans", "Segoe UI", system-ui, sans-serif',
                            fontSize: `${NODE_LABEL_FONT_SIZE}px`,
                            fontWeight: 500,
                            lineHeight: `${NODE_LABEL_LINE_HEIGHT}px`,
                            textAlign: "center",
                            padding: 0,
                            margin: 0,
                            overflow: "hidden",
                            whiteSpace: "normal",
                            wordBreak: "break-word",
                            boxSizing: "border-box",
                            userSelect: isEditing ? "text" : "none",
                            pointerEvents: isEditing ? "auto" : "none",
                            cursor: isEditing ? "text" : "inherit",
                          }}
                        >
                          {!isEditing ? label : null}
                        </div>
                      </foreignObject>
                    </g>

                    {showConnectHandle && (
                      <g
                        style={{ pointerEvents: "none" }}
                      >
                        <foreignObject
                          x={iconCenterX - connectIconSize / 2}
                          y={iconCenterY - connectIconSize / 2}
                          width={connectIconSize}
                          height={connectIconSize}
                          style={{ pointerEvents: "none" }}
                        >
                          <div
                            style={{
                              width: `${connectIconSize}px`,
                              height: `${connectIconSize}px`,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#0284c7",
                            }}
                          >
                            <Link2 size={14} />
                          </div>
                        </foreignObject>
                      </g>
                    )}
                  </g>
                )
              })}

              {/* Preview connection while connecting (arrow) */}
              {state.connecting && (() => {
                const fromNode = state.nodes.find((n) => n.id === state.connecting.from)
                const startX = fromNode ? fromNode.x + fromNode.width / 2 : getNodeCenter(state.nodes, state.connecting.from).x
                const startY = fromNode ? fromNode.y + fromNode.height / 2 : getNodeCenter(state.nodes, state.connecting.from).y

                return (
                  <g style={{ pointerEvents: "none" }}>
                    <defs>
                      <marker id="arrowhead-preview" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth">
                        <path d="M0,0 L0,6 L9,3 z" fill="#0ea5e9" />
                      </marker>
                    </defs>
                    <line
                      x1={startX}
                      y1={startY}
                      x2={state.connecting.currentX ?? startX}
                      y2={state.connecting.currentY ?? startY}
                      stroke="#0ea5e9"
                      strokeWidth="2"
                      strokeDasharray="5,5"
                      markerEnd="url(#arrowhead-preview)"
                    />
                  </g>
                )
              })()}

              {/* Box select rectangle */}
              {state.boxSelect && (() => {
                const r = rectFromPoints(state.boxSelect.start, state.boxSelect.current)
                return (
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill="rgba(14, 165, 233, 0.12)"
                    stroke="#0ea5e9"
                    strokeWidth="1.5"
                    strokeDasharray="4,3"
                    style={{ pointerEvents: "none" }}
                  />
                )
              })()}
            </g>
          </svg>
        </div>

        {/* Resize Handle */}
        {state.codePanelVisible && (
          <div
            onMouseDown={startResize}
            style={{
              width: "5px",
              cursor: "col-resize",
              background: state.resizing ? "#0ea5e9" : "transparent",
              transition: "background 0.2s",
              position: "relative",
              zIndex: 10,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#e2e8f0")}
            onMouseLeave={(e) => {
              if (!state.resizing) e.currentTarget.style.background = "transparent"
            }}
          />
        )}

        {/* Right Panel - Mermaid Code */}
        {state.codePanelVisible && (
          <div
            style={{
              width: `${state.codePanelWidth}px`,
              background: "white",
              borderLeft: "1px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                background: "#0ea5e9",
                color: "white",
                padding: "16px 20px",
                fontSize: "16px",
                fontWeight: "600",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Code size={20} />
                Mermaid Code
              </span>

              <div style={{ display: "flex", gap: "8px" }}>
                {state.codeEditMode && (
                  <>
                    <button
                      onClick={applyCodeChanges}
                      style={{
                        padding: "6px 12px",
                        background: "white",
                        color: "#0ea5e9",
                        border: "none",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Check size={14} />
                      Apply
                    </button>
                    <button
                      onClick={cancelCodeChanges}
                      style={{
                        padding: "6px 12px",
                        background: "rgba(255,255,255,0.15)",
                        color: "white",
                        border: "1px solid rgba(255,255,255,0.35)",
                        borderRadius: "4px",
                        fontSize: "12px",
                        fontWeight: "600",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <X size={14} />
                      Cancel
                    </button>
                  </>
                )}

                <button
                  onClick={copyCode}
                  style={{
                    padding: "6px 12px",
                    background: "white",
                    color: "#0ea5e9",
                    border: "none",
                    borderRadius: "4px",
                    fontSize: "12px",
                    fontWeight: "600",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {state.copySuccess ? (
                    <>
                      <Check size={14} />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <textarea
              value={state.mermaidCode}
              onChange={handleCodeChange}
              style={{
                flex: 1,
                padding: "20px",
                fontFamily: '"Fira Code", "SF Mono", Monaco, monospace',
                fontSize: "13px",
                lineHeight: "1.6",
                border: "none",
                outline: "none",
                resize: "none",
                background: "#fafafa",
                color: "#0f172a",
              }}
              spellCheck={false}
            />

            <div
              style={{
                padding: "16px 20px",
                background: "#f8fafc",
                borderTop: "1px solid #e2e8f0",
                fontSize: "12px",
                color: "#64748b",
                lineHeight: "1.5",
              }}
            >
              <strong style={{ color: "#334155", display: "block", marginBottom: "8px" }}>Mermaid Syntax (subset):</strong>
              Nodes: <code>ID[Label]</code>, <code>ID(Label)</code>, <code>ID{"{"}Label{"}"}</code>, <code>ID((Label))</code>, <code>ID([Label])</code>
              <br />
              Edges: <code>A --&gt; B</code>, <code>A --&gt;|label| B</code>
            </div>
          </div>
        )}
      </div>

      {/* Palette drag ghost */}
      {state.paletteDrag && (
        (() => {
          const { width: ghostWidth, height: ghostHeight } = getShapeSize(state.paletteDrag.shape)
          return (
            <div
              style={{
                position: "fixed",
                left: state.paletteDrag.clientX - ghostWidth / 2,
                top: state.paletteDrag.clientY - ghostHeight / 2,
                pointerEvents: "none",
                zIndex: 9999,
                transform: "translateZ(0)",
                opacity: state.paletteDrag.overCanvas ? 1 : 0.75,
              }}
            >
              <svg width={ghostWidth} height={ghostHeight} style={{ display: "block", filter: "drop-shadow(0px 6px 16px rgba(15, 23, 42, 0.2))" }}>
                {(() => {
                  const fill = state.paletteDrag.overCanvas ? "#dbeafe" : "#f0f9ff"
                  const stroke = state.paletteDrag.overCanvas ? "#0284c7" : "#94a3b8"

                  switch (state.paletteDrag.shape) {
                    case "diamond":
                      return (
                        <polygon
                          points={`${ghostWidth / 2},2 ${ghostWidth - 2},${ghostHeight / 2} ${ghostWidth / 2},${ghostHeight - 2} 2,${ghostHeight / 2}`}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth="2"
                        />
                      )
                    case "circle":
                      return (
                        <circle
                          cx={ghostWidth / 2}
                          cy={ghostHeight / 2}
                          r={ghostHeight / 2 - 3}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth="2"
                        />
                      )
                    case "stadium":
                      return (
                        <rect
                          x="2"
                          y="2"
                          width={ghostWidth - 4}
                          height={ghostHeight - 4}
                          rx={(ghostHeight - 4) / 2}
                          fill={fill}
                          stroke={stroke}
                          strokeWidth="2"
                        />
                      )
                    case "rounded":
                      return (
                        <rect x="2" y="2" width={ghostWidth - 4} height={ghostHeight - 4} rx={ROUNDED_RADIUS} fill={fill} stroke={stroke} strokeWidth="2" />
                      )
                    default:
                      return (
                        <rect x="2" y="2" width={ghostWidth - 4} height={ghostHeight - 4} fill={fill} stroke={stroke} strokeWidth="2" />
                      )
                  }
                })()}
                <text
                  x={ghostWidth / 2}
                  y={ghostHeight / 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#0f172a"
                  fontSize="13"
                  fontWeight="500"
                  style={{ userSelect: "none" }}
                >
                  New Node
                </text>
              </svg>
            </div>
          )
        })()
      )}
      {isInstructionsOpen && (
        <div
          onClick={() => setIsInstructionsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.45)",
            zIndex: 10001,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "85vh",
              overflowY: "auto",
              background: "white",
              borderRadius: "14px",
              border: "1px solid #dbeafe",
              boxShadow: "0 20px 40px rgba(15, 23, 42, 0.22)",
              padding: "26px 28px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "14px",
              }}
            >
              <h2 style={{ margin: 0, fontSize: "26px", color: "#0f172a", lineHeight: 1.15 }}>
                How to use
              </h2>
              <button
                onClick={() => setIsInstructionsOpen(false)}
                style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  border: "1px solid #cbd5e1",
                  background: "white",
                  color: "#475569",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                aria-label="Close instructions"
              >
                <X size={20} />
              </button>
            </div>
            <p style={{ margin: "0 0 14px 0", color: "#475569", fontSize: "14px", lineHeight: 1.6 }}>
              Full guide for canvas interactions, editing, and Mermaid code sync.
            </p>
            <ol
              style={{
                margin: 0,
                paddingLeft: 0,
                listStylePosition: "inside",
                color: "#1e293b",
                fontSize: "17px",
                lineHeight: 1.55,
                display: "grid",
                gap: "10px",
              }}
            >
              {usageInstructions.map((instruction, index) => (
                <li
                  key={index}
                  style={{
                    listStylePosition: "inside",
                    padding: "10px 12px",
                    border: "1px solid #e2e8f0",
                    borderRadius: "10px",
                    background: "#f8fafc",
                  }}
                >
                  <span style={{ color: "#0f172a", fontWeight: 700 }}>{instruction.lead}</span>
                  <span style={{ color: "#334155" }}>:</span>{" "}
                  <em style={{ color: "#334155" }}>{instruction.detail}</em>
                </li>
              ))}
            </ol>
            <div
              style={{
                marginTop: "14px",
                padding: "10px 12px",
                borderRadius: "10px",
                border: "1px solid #e2e8f0",
                background: "#f8fafc",
                color: "#475569",
                fontSize: "13px",
              }}
            >
              Tip: press <kbd style={{ padding: "1px 6px", border: "1px solid #cbd5e1", borderRadius: "6px", background: "white" }}>Esc</kbd> to close this modal.
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

