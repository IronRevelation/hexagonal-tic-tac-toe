import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import { PLAYER_MARKS, coordKey, type HexCoord, type SerializedGameState } from '../../shared/hexGame'
import { primaryButton, surfacePanel } from '../lib/ui'

type Camera = {
  x: number
  y: number
  zoom: number
}

type ViewportSize = {
  width: number
  height: number
}

type DragState = {
  pointerId: number
  startClientX: number
  startClientY: number
  startCamera: Camera
  moved: boolean
}

const HEX_SIZE = 36
const SQRT_3 = Math.sqrt(3)
const MIN_ZOOM = 0.45
const MAX_ZOOM = 2.2
const DRAG_THRESHOLD = 6
const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 }

export default function HexBoard({
  state,
  canPlay,
  disabled,
  onSelect,
  overlay,
}: {
  state: SerializedGameState
  canPlay: boolean
  disabled: boolean
  onSelect: (coord: HexCoord) => void
  overlay?: React.ReactNode
}) {
  const [camera, setCamera] = useState(INITIAL_CAMERA)
  const [viewport, setViewport] = useState<ViewportSize>({ width: 0, height: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const cameraRef = useRef(INITIAL_CAMERA)
  const viewportRef = useRef<ViewportSize>({ width: 0, height: 0 })
  const dragStateRef = useRef<DragState | null>(null)
  const board = new Map(state.board)
  const winningKeys = new Set(state.winningLine.map(coordKey))
  const lastMoveKey = state.lastMove ? coordKey(state.lastMove) : null

  useEffect(() => {
    const boardElement = boardRef.current
    if (!boardElement) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      const nextViewport = {
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }

      viewportRef.current = nextViewport
      setViewport(nextViewport)
    })

    observer.observe(boardElement)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const boardElement = boardRef.current
    if (!boardElement) {
      return
    }

    function handleNativeWheel(event: globalThis.WheelEvent) {
      event.preventDefault()
      applyWheelZoom(event.deltaY, event.clientX, event.clientY)
    }

    boardElement.addEventListener('wheel', handleNativeWheel, { passive: false })
    return () => boardElement.removeEventListener('wheel', handleNativeWheel)
  }, [])

  const worldWidth = viewport.width > 0 ? viewport.width / camera.zoom : 1200
  const worldHeight = viewport.height > 0 ? viewport.height / camera.zoom : 900
  const viewBoxMinX = camera.x - worldWidth / 2
  const viewBoxMinY = camera.y - worldHeight / 2
  const visibleCoords = getVisibleCoords(camera, viewport)
  const boardRect = {
    x: viewBoxMinX - HEX_SIZE * 6,
    y: viewBoxMinY - HEX_SIZE * 6,
    width: worldWidth + HEX_SIZE * 12,
    height: worldHeight + HEX_SIZE * 12,
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startCamera: cameraRef.current,
      moved: false,
    }
    setIsDragging(false)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragState.startClientX
    const deltaY = event.clientY - dragState.startClientY

    if (!dragState.moved && Math.hypot(deltaX, deltaY) > DRAG_THRESHOLD) {
      dragState.moved = true
      setIsDragging(true)
    }

    if (!dragState.moved) {
      return
    }

    const nextCamera = {
      ...dragState.startCamera,
      x: dragState.startCamera.x - deltaX / dragState.startCamera.zoom,
      y: dragState.startCamera.y - deltaY / dragState.startCamera.zoom,
    }
    cameraRef.current = nextCamera
    setCamera(nextCamera)
  }

  function finishPointerGesture(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return
    }

    if (!dragState.moved) {
      const coord = screenPointToHex(
        cameraRef.current,
        viewport,
        event.clientX,
        event.clientY,
        boardRef.current,
      )

      if (coord && canPlay && !disabled) {
        onSelect(coord)
      }
    }

    dragStateRef.current = null
    setIsDragging(false)

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  function applyWheelZoom(deltaY: number, clientX: number, clientY: number) {
    const boardElement = boardRef.current
    const nextViewport = viewportRef.current
    if (!boardElement || nextViewport.width === 0 || nextViewport.height === 0) {
      return
    }

    const rect = boardElement.getBoundingClientRect()
    const screenX = clientX - rect.left
    const screenY = clientY - rect.top
    const zoomFactor = Math.exp(-deltaY * 0.0012)
    const nextZoom = clamp(cameraRef.current.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM)
    const nextCamera = zoomCameraAtPoint(
      cameraRef.current,
      nextViewport,
      screenX,
      screenY,
      nextZoom,
    )

    cameraRef.current = nextCamera
    setCamera(nextCamera)
  }

  function nudgeZoom(multiplier: number) {
    if (viewport.width === 0 || viewport.height === 0) {
      return
    }

    const nextZoom = clamp(cameraRef.current.zoom * multiplier, MIN_ZOOM, MAX_ZOOM)
    const nextCamera = zoomCameraAtPoint(
      cameraRef.current,
      viewport,
      viewport.width / 2,
      viewport.height / 2,
      nextZoom,
    )

    cameraRef.current = nextCamera
    setCamera(nextCamera)
  }

  return (
    <section
      className={`${surfacePanel} relative h-full min-h-0 rounded-[1.8rem] p-[0.55rem] max-[720px]:min-h-[22rem] max-[720px]:rounded-[1.35rem]`}
    >
      <div
        className={`board-viewport ${isDragging ? 'is-dragging' : ''} ${
          canPlay && !disabled ? '' : 'is-locked'
        }`}
        onContextMenu={(event) => event.preventDefault()}
        onPointerCancel={finishPointerGesture}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        ref={boardRef}
      >
        {overlay ? (
          <div
            className="absolute top-4 left-4 z-[2] max-[720px]:top-[0.8rem] max-[720px]:left-[0.8rem]"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {overlay}
          </div>
        ) : null}
        <div
          aria-label="Zoom controls"
          className="absolute top-4 right-4 z-[2] inline-flex gap-[0.55rem] max-[720px]:top-[0.8rem] max-[720px]:right-[0.8rem]"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            className={`${primaryButton} h-[2.6rem] min-h-0 w-[2.6rem] p-0 text-[1.15rem]`}
            onClick={() => nudgeZoom(1 / 1.15)}
            type="button"
          >
            -
          </button>
          <button
            className={`${primaryButton} h-[2.6rem] min-h-0 w-[2.6rem] p-0 text-[1.15rem]`}
            onClick={() => nudgeZoom(1.15)}
            type="button"
          >
            +
          </button>
        </div>
        <svg
          aria-label="Hexagonal tic-tac-toe board"
          className="board-svg"
          role="img"
          viewBox={`${viewBoxMinX} ${viewBoxMinY} ${worldWidth} ${worldHeight}`}
        >
          <defs>
            <pattern
              height="104"
              id="boardDust"
              patternUnits="userSpaceOnUse"
              width="120"
            >
              <circle cx="12" cy="12" fill="rgba(255, 241, 217, 0.16)" r="2.2" />
              <circle cx="60" cy="56" fill="rgba(255, 241, 217, 0.11)" r="1.4" />
              <circle cx="98" cy="26" fill="rgba(255, 241, 217, 0.1)" r="1.8" />
              <circle cx="44" cy="88" fill="rgba(255, 241, 217, 0.1)" r="1.6" />
            </pattern>
            <radialGradient cx="50%" cy="50%" id="boardGlow" r="72%">
              <stop offset="0%" stopColor="#16384a" />
              <stop offset="100%" stopColor="#0a1724" />
            </radialGradient>
          </defs>

          <rect
            fill="url(#boardGlow)"
            height={boardRect.height}
            width={boardRect.width}
            x={boardRect.x}
            y={boardRect.y}
          />
          <rect
            fill="url(#boardDust)"
            height={boardRect.height}
            opacity="0.85"
            width={boardRect.width}
            x={boardRect.x}
            y={boardRect.y}
          />

          {visibleCoords.map((coord) => {
            const key = coordKey(coord)
            const owner = board.get(key)
            const center = axialToPixel(coord)
            const className = [
              'hex-cell',
              owner ? `player-${owner}` : 'is-empty',
              key === lastMoveKey ? 'is-last-move' : '',
              winningKeys.has(key) ? 'is-winning-line' : '',
              key === '0,0' ? 'is-origin' : '',
            ]
              .filter(Boolean)
              .join(' ')

            return (
              <g className={className} key={key}>
                <polygon points={hexPolygonPoints(center, HEX_SIZE - 2.2)} />
                {owner ? (
                  <>
                    <circle
                      className={`stone stone-${owner}`}
                      cx={center.x}
                      cy={center.y}
                      r={HEX_SIZE * 0.5}
                    />
                    <text className="stone-mark" x={center.x} y={center.y + 1}>
                      {PLAYER_MARKS[owner]}
                    </text>
                  </>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}

function getVisibleCoords(camera: Camera, viewport: ViewportSize): HexCoord[] {
  const worldWidth = viewport.width > 0 ? viewport.width / camera.zoom : 1200
  const worldHeight = viewport.height > 0 ? viewport.height / camera.zoom : 900
  const minX = camera.x - worldWidth / 2 - HEX_SIZE * 4
  const maxX = camera.x + worldWidth / 2 + HEX_SIZE * 4
  const minY = camera.y - worldHeight / 2 - HEX_SIZE * 4
  const maxY = camera.y + worldHeight / 2 + HEX_SIZE * 4
  const minR = Math.floor(minY / (HEX_SIZE * 1.5)) - 2
  const maxR = Math.ceil(maxY / (HEX_SIZE * 1.5)) + 2
  const coords: HexCoord[] = []

  for (let r = minR; r <= maxR; r += 1) {
    const minQ = Math.floor(minX / (SQRT_3 * HEX_SIZE) - r / 2) - 2
    const maxQ = Math.ceil(maxX / (SQRT_3 * HEX_SIZE) - r / 2) + 2

    for (let q = minQ; q <= maxQ; q += 1) {
      coords.push({ q, r })
    }
  }

  return coords
}

function axialToPixel(coord: HexCoord) {
  return {
    x: HEX_SIZE * SQRT_3 * (coord.q + coord.r / 2),
    y: HEX_SIZE * 1.5 * coord.r,
  }
}

function pixelToAxial(point: { x: number; y: number }): HexCoord {
  const q = ((SQRT_3 / 3) * point.x - point.y / 3) / HEX_SIZE
  const r = ((2 / 3) * point.y) / HEX_SIZE
  return roundAxial({ q, r })
}

function roundAxial(coord: { q: number; r: number }): HexCoord {
  let q = Math.round(coord.q)
  let r = Math.round(coord.r)
  const s = Math.round(-coord.q - coord.r)
  const qDiff = Math.abs(q - coord.q)
  const rDiff = Math.abs(r - coord.r)
  const sDiff = Math.abs(s + coord.q + coord.r)

  if (qDiff > rDiff && qDiff > sDiff) {
    q = -r - s
  } else if (rDiff > sDiff) {
    r = -q - s
  }

  return { q, r }
}

function hexPolygonPoints(center: { x: number; y: number }, radius: number) {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = ((60 * index - 30) * Math.PI) / 180
    const x = center.x + radius * Math.cos(angle)
    const y = center.y + radius * Math.sin(angle)
    return `${x},${y}`
  }).join(' ')
}

function zoomCameraAtPoint(
  current: Camera,
  viewport: ViewportSize,
  screenX: number,
  screenY: number,
  nextZoom: number,
) {
  if (nextZoom === current.zoom) {
    return current
  }

  const worldX = current.x + (screenX - viewport.width / 2) / current.zoom
  const worldY = current.y + (screenY - viewport.height / 2) / current.zoom

  return {
    x: worldX - (screenX - viewport.width / 2) / nextZoom,
    y: worldY - (screenY - viewport.height / 2) / nextZoom,
    zoom: nextZoom,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function screenPointToHex(
  camera: Camera,
  viewport: ViewportSize,
  clientX: number,
  clientY: number,
  board: HTMLDivElement | null,
) {
  if (!board || viewport.width === 0 || viewport.height === 0) {
    return null
  }

  const rect = board.getBoundingClientRect()
  const screenX = clientX - rect.left
  const screenY = clientY - rect.top
  const worldX = camera.x + (screenX - viewport.width / 2) / camera.zoom
  const worldY = camera.y + (screenY - viewport.height / 2) / camera.zoom

  return pixelToAxial({ x: worldX, y: worldY })
}
