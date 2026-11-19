import { AnimatePresence, motion } from 'framer-motion'
import { ImageIcon, Minimize2, Minus, Pause, Play, Plus, Redo2, RefreshCw, Trash2, Undo2, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createTapTempo, engine } from './audio/engine'
import { ArticulationPalette } from './components/ArticulationPalette'
import { Calibration } from './components/Calibration'
import { importProfile, loadProfile, restoreProfile } from './recognition/profile'
import { ExportModal } from './components/ExportModal'
import { HelpModal } from './components/HelpModal'
import { ModeSwitch } from './components/ModeSwitch'
import { MAX_ZOOM, MIN_ZOOM, ScoreCanvas } from './components/ScoreCanvas'
import { TopBar } from './components/TopBar'
import { type TransportHandle, TransportBar } from './components/TransportBar'
import { Tuner } from './components/Tuner'
import { ELASTIC } from './components/springs'
import { Toast, Modal as UiModal } from './components/ui'
import { EXAMPLES, emptyScore } from './state/examples'
import {
  buildEvents,
  clampStep,
  effectiveAccidental,
  soundingMidi,
  writtenMidi,
} from './state/music'
import { useScore } from './state/useScore'
import type { Background, EditMode, LoopRange, Meter, Note, Score, Transposition, TupletKind } from './types'
import { fileSlug, parseMilaFile, type SavedScore, toMilaFile } from './state/library'
import { useLibrary } from './state/useLibrary'
import { saveFileAs } from './export/share'
import { Gallery } from './components/Gallery'
import { BackgroundPanel } from './components/BackgroundPanel'
import { ScanSheet } from './components/ScanSheet'
import { fileToScan } from './scan/importScan'
import { digitize } from './scan/digitize'
import { blobToDataUrl, dataUrlToBlob, deleteImage, getImage, imageIdsOf, parseMilaHand, parseMilaImages, putImage } from './state/library'
import { newId } from './state/music'
import { useImageUrl } from './state/useImageUrl'
import { useUpdateReady, useWakeLock } from './state/pwa'
import { IconButton } from './components/ui'
import { TOP_PAD } from './notation/renderScore'

type Modal = 'tuner' | 'export' | 'help' | 'clear' | 'gallery' | 'scan' | null

const NO_ANNOTATIONS: never[] = []

/** Ancho fijo de la hoja digital cuando hay partitura escaneada (se escala a la pantalla). */
const SCAN_LAYOUT_W = 900

/** Compases necesarios para que los pentagramas digitales cubran toda la partitura escaneada. */
function measuresToCover(bg: Background): number {
  const bottom = bg.y + bg.layoutWidth * bg.scale * (bg.naturalH / bg.naturalW)
  const rows = Math.max(1, Math.ceil((bottom - TOP_PAD - 24) / bg.rowH))
  let n = 0
  for (let r = 0; r < rows; r++) n += bg.rowWidths?.[r]?.length ?? bg.perRow
  return Math.min(64, n)
}

export default function App() {
  const api = useScore()
  const { score } = api
  /** Métrica de la partitura (las antiguas, sin este dato, son 4/4). */
  const meter: Meter = score.meter ?? '4/4'
  const lib = useLibrary(score)

  const [dark, setDark] = useState(() => localStorage.getItem('mila:theme') === 'dark')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [metroOnly, setMetroOnly] = useState(false)
  const [cursorId, setCursorId] = useState<string | null>(null)
  const [metro, setMetro] = useState(false)
  const [loopOn, setLoopOn] = useState(false)
  const [loopRange, setLoopRange] = useState<LoopRange | null>(null)
  const [modal, setModal] = useState<Modal>(null)
  const [fingerDraw, setFingerDraw] = useState(false)
  /** Pantalla de escritura: se ocultan barras y paleta para escribir con todo el iPad (sobre todo en horizontal). */
  const [focus, setFocus] = useState(() => {
    try {
      return localStorage.getItem('mila:focus') === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem('mila:focus', focus ? '1' : '0')
    } catch {
      /* sin almacenamiento */
    }
  }, [focus])
  const updateReady = useUpdateReady()
  const [adjustBg, setAdjustBg] = useState(false)
  const [userZoom, setUserZoom] = useState(1)
  const zoomBy = useCallback((k: number) => setUserZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z * k * 100) / 100))), [])
  const [bgPanel, setBgPanel] = useState(false)
  const [scanBusy, setScanBusy] = useState(false)
  const bgUrl = useImageUrl(score.background?.imageId)
  const [mode, setModeState] = useState<EditMode>('notes')
  // Test de escritura: NUNCA se abre solo ni bloquea la entrada. Solo desde la guía (?), si Mila quiere
  // enseñarle más muestras de su letra.
  const [calib, setCalib] = useState(false)
  // Los resultados de los tests ya hechos se conservan y se usan para reconocer su letra (con copia en IndexedDB).
  useEffect(() => {
    void restoreProfile().catch(() => undefined)
  }, [])
  const [toast, setToast] = useState<{ msg: string; tone: 'info' | 'warn' } | null>(null)
  const transportRef = useRef<TransportHandle>(null)
  const toastTimer = useRef(0)
  const tap = useMemo(() => createTapTempo(), [])

  // ---- Tema ----------------------------------------------------------------
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('mila:theme', dark ? 'dark' : 'light')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#12101d' : '#fff1d6')
  }, [dark])

  const showToast = useCallback((msg: string, tone: 'info' | 'warn' = 'info') => {
    setToast({ msg, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2600)
  }, [])

  const setMode = useCallback((m: EditMode) => {
    setModeState(m)
    // Elegir una herramienta (Notas, Anotar, Goma) termina "mover la hoja": si no, la goma o el lápiz
    // arrastrarían la foto en vez de borrar o escribir.
    setAdjustBg(false)
    if (m !== 'notes') setSelectedId(null)
  }, [])

  // ---- Motor de audio ------------------------------------------------------
  useEffect(() => {
    engine.onCursor = (c) => setCursorId(c?.noteId ?? null)
    engine.onBeat = () => transportRef.current?.pulse()
    engine.onStop = () => setPlaying(false)
    return () => {
      engine.onCursor = null
      engine.onBeat = null
      engine.onStop = null
      engine.stop(false)
    }
  }, [])

  const lastUsed = useMemo(() => {
    for (let i = score.measures.length - 1; i >= 0; i--) if (score.measures[i].length) return i
    return 0
  }, [score.measures])

  // Mientras suena la partitura o el metrónomo, el iPad no apaga la pantalla.
  useWakeLock(playing || metroOnly)

  const startPlayback = useCallback(async () => {
    const range = loopOn && loopRange ? loopRange : { start: 0, end: lastUsed }
    const { events, totalUnits } = buildEvents(score.measures, score.transposition, range, meter)
    if (events.length === 0) {
      showToast('Escribe alguna nota para poder escucharla.', 'warn')
      return
    }
    engine.setMetronome(metro)
    engine.setMeter(meter)
    setMetroOnly(false)
    await engine.play({ events, totalUnits, loop: loopOn, bpm: score.bpm })
    setPlaying(true)
  }, [loopOn, loopRange, lastUsed, score.measures, score.transposition, score.bpm, meter, metro, showToast])

  const stopPlayback = useCallback(() => {
    engine.stop(false)
    setPlaying(false)
    setMetroOnly(false)
    setCursorId(null)
  }, [])

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback()
    else void startPlayback()
  }, [playing, startPlayback, stopPlayback])

  // Reiniciar la reproducción al cambiar transposición o bucle mientras suena.
  const startRef = useRef(startPlayback)
  startRef.current = startPlayback
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    if (engine.isPlaying) void startRef.current()
  }, [score.transposition, meter, loopOn, loopRange])

  const setBpm = useCallback(
    (v: number) => {
      const bpm = Math.max(30, Math.min(240, Math.round(v)))
      api.patch({ bpm })
      engine.setBpm(bpm)
    },
    [api],
  )

  const toggleMetro = useCallback(async () => {
    const next = !metro
    setMetro(next)
    engine.setMetronome(next)
    if (next && !playing) {
      engine.setMeter(meter)
      await engine.startMetronomeOnly(score.bpm)
      setMetroOnly(true)
    } else if (!next && metroOnly) {
      engine.stop(false)
      setMetroOnly(false)
    }
  }, [metro, playing, metroOnly, score.bpm, meter])

  const onTap = useCallback(() => {
    const v = tap()
    if (v) setBpm(v)
  }, [tap, setBpm])

  const onBadge = useCallback(
    (i: number) => {
      if (!loopOn) return
      setLoopRange((r) => {
        if (!r) return { start: i, end: i }
        if (r.start === r.end) return i >= r.start ? { start: r.start, end: i } : { start: i, end: r.start }
        return { start: i, end: i }
      })
    },
    [loopOn],
  )

  // ---- Edición de la nota seleccionada --------------------------------------
  const selected = useMemo(() => {
    if (!selectedId) return null
    for (let mi = 0; mi < score.measures.length; mi++) {
      const idx = score.measures[mi].findIndex((n) => n.id === selectedId)
      if (idx >= 0) return { note: score.measures[mi][idx], mi, idx }
    }
    return null
  }, [selectedId, score.measures])

  const editSelected = useCallback(
    (fn: (n: Note) => Note) => {
      if (!selectedId) return
      stopPlayback()
      api.setMeasures((ms) => ms.map((m) => (m.some((n) => n.id === selectedId) ? m.map((n) => (n.id === selectedId ? fn(n) : n)) : m)))
    },
    [selectedId, api, stopPlayback],
  )

  const previewNote = useCallback(
    (note: Note, mi: number, idx: number, patch: Partial<Note> = {}) => {
      if (note.kind !== 'note') return
      const m = score.measures[mi].map((n, i) => (i === idx ? { ...n, ...patch } : n))
      const acc = effectiveAccidental(m, idx)
      void engine.preview(soundingMidi(writtenMidi(m[idx].step, acc), score.transposition), 240)
    },
    [score.measures, score.transposition],
  )

  const onAcc = useCallback(
    (a: '#' | 'b' | 'n') => {
      if (!selected || selected.note.kind !== 'note') return
      const acc = selected.note.acc === a ? '' : a
      editSelected((n) => ({ ...n, acc }))
      previewNote(selected.note, selected.mi, selected.idx, { acc })
    },
    [selected, editSelected, previewNote],
  )

  const onToggle = useCallback(
    (k: 'staccato' | 'accent' | 'slur') => {
      if (!selected) return
      editSelected((n) => ({ ...n, [k]: !n[k] }))
    },
    [selected, editSelected],
  )

  /** Puntillo: suma la mitad del valor (también en silencios). */
  const onDot = useCallback(() => {
    if (!selected) return
    editSelected((n) => ({ ...n, dot: !n.dot }))
  }, [selected, editSelected])

  /**
   * Grupo especial desde la nota seleccionada: toma esa nota y las siguientes del compás hasta completar `k`
   * figuras (tresillo 3, quintillo 5, seisillo 6). Si la nota ya está en un grupo igual, lo deshace.
   */
  const onTuplet = useCallback(
    (k: TupletKind) => {
      if (!selected) return
      stopPlayback()
      const { mi, idx, note } = selected
      api.setMeasures((ms) =>
        ms.map((m, i) => {
          if (i !== mi) return m
          const old = note.tuplet
          // Deshacer el grupo actual de la nota (siempre); si era del mismo tipo, ahí termina.
          let out = old ? m.map((n) => (n.tuplet?.id === old.id ? { ...n, tuplet: undefined } : n)) : m
          if (old?.n === k) return out
          const id = newId()
          const end = Math.min(out.length, idx + k)
          const touched = new Set<string>()
          for (let j = idx; j < end; j++) if (out[j].tuplet) touched.add(out[j].tuplet!.id)
          out = out.map((n, j) => {
            if (j >= idx && j < end) return { ...n, tuplet: { id, n: k } }
            if (n.tuplet && touched.has(n.tuplet.id)) return { ...n, tuplet: undefined }
            return n
          })
          return out
        }),
      )
    },
    [selected, api, stopPlayback],
  )

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    stopPlayback()
    api.setMeasures((ms) => ms.map((m) => (m.some((n) => n.id === selectedId) ? m.filter((n) => n.id !== selectedId) : m)))
    setSelectedId(null)
  }, [selectedId, api, stopPlayback])

  const nudgePitch = useCallback(
    (d: number) => {
      if (!selected || selected.note.kind !== 'note') return
      const step = clampStep(selected.note.step + d)
      if (step === selected.note.step) return
      editSelected((n) => ({ ...n, step }))
      previewNote(selected.note, selected.mi, selected.idx, { step })
    },
    [selected, editSelected, previewNote],
  )

  const moveSelection = useCallback(
    (d: number) => {
      const flat = score.measures.flat()
      if (flat.length === 0) return
      const i = selectedId ? flat.findIndex((n) => n.id === selectedId) : -1
      const next = flat[Math.max(0, Math.min(flat.length - 1, i < 0 ? (d > 0 ? 0 : flat.length - 1) : i + d))]
      setSelectedId(next.id)
    },
    [score.measures, selectedId],
  )

  const clearAll = useCallback(() => {
    stopPlayback()
    api.clearAll()
    setSelectedId(null)
    setLoopRange(null)
    setModal(null)
    showToast('Partitura borrada · ⌘Z para recuperarla')
  }, [api, stopPlayback, showToast])

  // ---- Galería (Mis partituras) -------------------------------------------------
  /** Muestra otra partitura en el editor (la anterior ya quedó guardada). */
  const showScore = useCallback(
    (s: Score) => {
      stopPlayback()
      api.open(s)
      engine.setBpm(s.bpm)
      setSelectedId(null)
      setLoopRange(null)
      setModeState('notes')
      setAdjustBg(false)
      setBgPanel(false)
      setModal(null)
    },
    [api, stopPlayback],
  )

  const openFromGallery = useCallback(
    async (id: string) => {
      if (id === lib.currentId) return setModal(null)
      await lib.flush()
      const item = await lib.openItem(id)
      if (!item) return showToast('No encontré esa partitura', 'warn')
      showScore(item.score)
      showToast(`Abierta: ${item.score.title || 'Sin título'}`)
    },
    [lib, showScore, showToast],
  )

  const startScore = useCallback(
    async (s: Score, msg: string) => {
      await lib.flush()
      lib.startNew()
      showScore(s)
      showToast(msg)
    },
    [lib, showScore, showToast],
  )

  const newScore = useCallback(
    () => void startScore({ ...emptyScore(), transposition: score.transposition }, 'Partitura nueva'),
    [startScore, score.transposition],
  )

  const fromExample = useCallback(
    (key: string) => {
      const ex = EXAMPLES.find((e) => e.key === key)
      if (ex) void startScore({ ...ex.build(), transposition: score.transposition as Transposition }, `Nueva desde ejemplo: ${ex.name}`)
    },
    [startScore, score.transposition],
  )

  const duplicateItem = useCallback(
    (item: SavedScore) =>
      void startScore(
        { ...item.score, title: `${item.score.title || 'Sin título'} (copia)` },
        'Copia creada: ya puedes editarla',
      ),
    [startScore],
  )

  const deleteItem = useCallback(
    async (id: string) => {
      // Su imagen escaneada se borra solo si ninguna otra partitura la usa.
      const imageId = lib.items.find((x) => x.id === id)?.score.background?.imageId
      const shared =
        !!imageId &&
        (lib.items.some((x) => x.id !== id && x.score.background?.imageId === imageId) ||
          (id !== lib.currentId && score.background?.imageId === imageId))
      await lib.remove(id)
      if (imageId && !shared) void deleteImage(imageId).catch(() => undefined)
      if (id === lib.currentId) {
        lib.startNew()
        api.open({ ...emptyScore(), transposition: score.transposition })
        setSelectedId(null)
      }
      showToast('Partitura borrada de la galería')
    },
    [lib, api, score.transposition, score.background, showToast],
  )

  /**
   * «Guardar en…»: Mila elige dónde guardar (una carpeta del iPad o del móvil, iCloud Drive, Drive, la compu…).
   * El archivo .mila.json lleva todo (y la foto si es escaneada) y se vuelve a abrir con «Abrir desde Archivos».
   */
  const saveToFiles = useCallback(
    async (items: SavedScore[]) => {
      const single = items.length === 1
      const name = single
        ? `${fileSlug(items[0].score.title)}.mila.json`
        : `MILA-galeria-${new Date().toISOString().slice(0, 10)}.mila.json`
      const build = async () => {
        await lib.flush()
        // Las partituras escaneadas viajan con su imagen dentro del archivo.
        const images: Record<string, string> = {}
        for (const id of imageIdsOf(items)) {
          const blob = await getImage(id).catch(() => undefined)
          if (blob) images[id] = await blobToDataUrl(blob)
        }
        // La copia de toda la galería lleva también la letra de Mila (resultados de todos sus tests), para
        // recuperarla en otro dispositivo o si se borran los datos del navegador.
        const hand = single ? undefined : loadProfile()
        const withHand = hand && Object.keys(hand.samples).length ? hand : undefined
        return new File([JSON.stringify(toMilaFile(items, images, withHand))], name, { type: 'application/json' })
      }
      try {
        const r = await saveFileAs(name, build, single ? items[0].score.title || 'Partitura MILA' : 'Partituras MILA')
        if (r === 'saved') showToast('Guardado ✓')
        else if (r === 'shared') showToast('Listo ✓ (con «Guardar en Archivos» eliges la carpeta)')
        else if (r === 'downloaded') showToast('Guardado en Descargas')
        else if (r === 'blocked') showToast('Toca otra vez para guardar')
      } catch {
        showToast('No se pudo guardar el archivo', 'warn')
      }
    },
    [lib, showToast],
  )

  /** Guardar en… la partitura abierta (barra superior o ⌘S). */
  const saveCurrentAs = useCallback(() => {
    const now = Date.now()
    const known = lib.items.find((x) => x.id === lib.currentId)
    void saveToFiles([{ id: lib.currentId, score, createdAt: known?.createdAt ?? now, updatedAt: now }])
  }, [lib.items, lib.currentId, score, saveToFiles])

  const importFiles = useCallback(
    async (files: File[]) => {
      try {
        const all: SavedScore[] = []
        let handRestored = false
        for (const f of files) {
          const text = await f.text()
          if (importProfile(parseMilaHand(text))) handRestored = true
          all.push(...parseMilaFile(text))
          for (const [id, url] of Object.entries(parseMilaImages(text))) {
            if (!(await getImage(id).catch(() => undefined))) await putImage(id, await dataUrlToBlob(url))
          }
        }
        const n = await lib.importItems(all)
        const msg = n ? `${n} partitura${n === 1 ? '' : 's'} añadida${n === 1 ? '' : 's'} a la galería` : 'Ya tenías esas partituras'
        showToast(handRestored ? `${msg} · y tu letra del test de escritura` : msg)
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'No se pudo abrir el archivo', 'warn')
      }
    },
    [lib, showToast],
  )

  // ---- Partitura escaneada de fondo -------------------------------------------
  /** Cambia el fondo y, si hace falta, añade compases para que el pentagrama cubra todo el papel. */
  const onBackground = useCallback(
    (bg: Background, record = false) => {
      api.setBackground(bg, record)
      const need = measuresToCover(bg)
      if (need > score.measures.length) {
        api.setMeasures((ms) => [...ms, ...Array.from({ length: need - ms.length }, () => [])], false)
      }
    },
    [api, score.measures.length],
  )

  const handleScanFile = useCallback(
    async (file: File, convert: boolean) => {
      setScanBusy(true)
      try {
        const r = await fileToScan(file)
        const imageId = newId()
        await putImage(imageId, r.blob)
        // Convertir la foto en notas editables (OMR) y alinear la hoja automáticamente.
        const dig = convert ? await digitize(r.canvas).catch(() => null) : null
        const pages = r.pages && r.pages.total > r.pages.used ? ` (se usaron ${r.pages.used} de ${r.pages.total} páginas)` : ''
        if (dig) {
          const bg: Background = { imageId, naturalW: r.width, naturalH: r.height, ...dig.placement, opacity: 0.35, enhance: true }
          const blank = score.measures.every((m) => m.length === 0) && !(score.annotations ?? []).length && !score.background
          const next = { title: r.title, measures: dig.measures.length ? dig.measures : [[]], background: bg }
          if (blank) {
            stopPlayback()
            api.open({ ...score, ...next, title: score.title === 'Sin título' ? r.title : score.title })
          } else {
            await startScore({ ...emptyScore(), transposition: score.transposition, ...next }, '')
          }
          setModal(null)
          setMode('notes')
          setBgPanel(false)
          setAdjustBg(false)
          const n = dig.result.noteCount
          showToast(
            n
              ? `Detecté ${n} notas en ${dig.measures.length} compases: revísalas y corrige lo que haga falta${pages}`
              : `Encontré ${dig.result.staves.length} pentagramas pero ninguna nota clara: escríbelas encima${pages}`,
          )
          return
        }
        const bg: Background = {
          imageId,
          naturalW: r.width,
          naturalH: r.height,
          layoutWidth: SCAN_LAYOUT_W,
          rowH: 160,
          perRow: 4,
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          opacity: 0.6,
          enhance: true,
        }
        const blank = score.measures.every((m) => m.length === 0) && !(score.annotations ?? []).length && !score.background
        const measures = Array.from({ length: measuresToCover(bg) }, () => [])
        if (blank) {
          // Hoja vacía: el escaneo se queda en esta misma partitura.
          stopPlayback()
          api.open({ ...score, title: score.title === 'Sin título' ? r.title : score.title, measures, background: bg })
        } else {
          await startScore({ ...emptyScore(), title: r.title, transposition: score.transposition, measures, background: bg }, '')
        }
        setModal(null)
        setMode('notes')
        setBgPanel(true)
        setAdjustBg(true)
        showToast(
          convert
            ? `No encontré pentagramas claros en la foto: alinéala a mano (foto recta, buena luz)${pages}`
            : `Arrastra la hoja y ajusta el tamaño hasta que el pentagrama coincida${pages}`,
          convert ? 'warn' : 'info',
        )
      } catch (e) {
        showToast(e instanceof Error ? e.message : 'No se pudo importar la partitura', 'warn')
      } finally {
        setScanBusy(false)
      }
    },
    [api, score, startScore, stopPlayback, setMode, showToast],
  )

  /** "Detectar notas" sobre un fondo ya colocado: reemplaza los compases por lo que se lee en el papel. */
  const [detecting, setDetecting] = useState(false)
  const detectNotes = useCallback(async () => {
    const bg = score.background
    if (!bg) return
    setDetecting(true)
    try {
      const blob = await getImage(bg.imageId)
      if (!blob) throw new Error('No encuentro la imagen escaneada')
      const bmp = await createImageBitmap(blob)
      const c = document.createElement('canvas')
      c.width = bmp.width
      c.height = bmp.height
      c.getContext('2d')!.drawImage(bmp, 0, 0)
      bmp.close()
      const dig = await digitize(c)
      if (!dig) return showToast('No encontré pentagramas claros en la imagen', 'warn')
      stopPlayback()
      api.setBackground({ ...bg, ...dig.placement, opacity: Math.min(bg.opacity, 0.35) }, true)
      api.setMeasures(() => (dig.measures.length ? dig.measures : [[]]), false)
      setSelectedId(null)
      setAdjustBg(false)
      showToast(`Detecté ${dig.result.noteCount} notas en ${dig.measures.length} compases · ⌘Z para deshacer`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'No se pudo analizar la imagen', 'warn')
    } finally {
      setDetecting(false)
    }
  }, [api, score.background, stopPlayback, showToast])

  const removeBackground = useCallback(() => {
    api.setBackground(undefined, true)
    setAdjustBg(false)
    setBgPanel(false)
    showToast('Fondo quitado · ⌘Z para recuperarlo')
  }, [api, showToast])

  // ---- Atajos de teclado (Mac) ----------------------------------------------
  const kb = useRef<Record<string, (e: KeyboardEvent) => void>>({})
  kb.current = {
    play: () => togglePlay(),
    undo: () => api.undo(),
    redo: () => api.redo(),
    del: () => deleteSelected(),
    up: () => nudgePitch(1),
    down: () => nudgePitch(-1),
    left: () => moveSelection(-1),
    right: () => moveSelection(1),
    sharp: () => onAcc('#'),
    flat: () => onAcc('b'),
    natural: () => onAcc('n'),
    staccato: () => onToggle('staccato'),
    accent: () => onToggle('accent'),
    slur: () => onToggle('slur'),
    dot: () => onDot(),
    save: () => saveCurrentAs(),
    tuplet3: () => onTuplet(3),
    mode: () => setMode(mode === 'notes' ? 'annotate' : 'notes'),
    erase: () => setMode(mode === 'erase' ? 'notes' : 'erase'),
    convert: () => window.dispatchEvent(new Event('mila:convert')),
    zoomIn: () => zoomBy(1.25),
    zoomOut: () => zoomBy(0.8),
    zoomReset: () => setUserZoom(1),
    focus: () => setFocus((v) => !v),
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (typing) return
      const mod = e.metaKey || e.ctrlKey
      const run = (k: string) => {
        e.preventDefault()
        kb.current[k](e)
      }
      if (mod && e.key.toLowerCase() === 'z') return run(e.shiftKey ? 'redo' : 'undo')
      if (mod && e.key.toLowerCase() === 'y') return run('redo')
      if (mod && e.key.toLowerCase() === 's') return run('save')
      if (mod && (e.key === '=' || e.key === '+')) return run('zoomIn')
      if (mod && e.key === '-') return run('zoomOut')
      if (mod && e.key === '0') return run('zoomReset')
      if (mod || e.altKey) return
      switch (e.key) {
        case ' ':
          return run('play')
        case 'Backspace':
        case 'Delete':
          return run('del')
        case 'ArrowUp':
          return run('up')
        case 'ArrowDown':
          return run('down')
        case 'ArrowLeft':
          return run('left')
        case 'ArrowRight':
          return run('right')
        case '#':
          return run('sharp')
        case 'b':
          return run('flat')
        case 'n':
          return run('natural')
        case 's':
          return run('staccato')
        case 'a':
          return run('accent')
        case 'l':
          return run('slur')
        case '.':
          return run('dot')
        case '3':
          return run('tuplet3')
        case 'm':
          return run('mode')
        case 'g':
          return run('erase')
        case 'Enter':
          return run('convert')
        case 'f':
          return run('focus')
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ' && !(e.target as HTMLElement | null)?.closest?.('input,textarea')) e.preventDefault()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const canSlur = !!selected && selected.idx < score.measures[selected.mi].length - 1 && score.measures[selected.mi][selected.idx + 1].kind === 'note'
  const loopLabel = loopOn ? (loopRange ? `c.${loopRange.start + 1}–${loopRange.end + 1}` : 'todo') : 'bucle'

  return (
    <div className="flex h-full flex-col bg-bg text-ink">
      {!focus && (
      <TopBar
        title={score.title}
        onTitle={(title) => api.patch({ title })}
        transposition={score.transposition}
        onTransposition={(t) => api.patch({ transposition: t })}
        meter={meter}
        onMeter={(m) => api.patch({ meter: m })}
        dark={dark}
        onTheme={() => setDark((d) => !d)}
        playing={playing}
        canUndo={api.canUndo}
        canRedo={api.canRedo}
        onUndo={api.undo}
        onRedo={api.redo}
        onTuner={() => setModal('tuner')}
        onExport={() => setModal('export')}
        onSave={saveCurrentAs}
        onHelp={() => setModal('help')}
        onGallery={() => {
          void lib.flush().then(lib.refresh)
          setModal('gallery')
        }}
        fingerDraw={fingerDraw}
        onFinger={() => {
          setFingerDraw((v) => !v)
          showToast(fingerDraw ? 'Solo Apple Pencil / ratón dibujan' : 'Ahora el dedo también dibuja')
        }}
        onFocus={() => setFocus(true)}
      />
      )}

      <div className="relative flex min-h-0 flex-1">
        {!focus && (
        <ArticulationPalette
          note={selected?.note ?? null}
          canSlur={canSlur}
          onAcc={onAcc}
          onToggle={onToggle}
          onDot={onDot}
          onTuplet={onTuplet}
          onDelete={deleteSelected}
        />
        )}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <AnimatePresence>
            {loopOn && (
              <motion.div
                className="pointer-events-none absolute bottom-4 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-sun px-4 py-1.5 text-xs font-extrabold text-[#2b2118] shadow-lg"
                initial={{ opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12 }}
              >
                Toca los números de compás para elegir el bucle (inicio → fin)
              </motion.div>
            )}
          </AnimatePresence>
          {focus && (
            <div
              className="pointer-events-none absolute right-4 top-3 z-40 flex items-center gap-1.5 rounded-full border border-line bg-panel/95 p-1 shadow backdrop-blur"
              style={{ top: 'max(12px, env(safe-area-inset-top))', right: 'max(16px, env(safe-area-inset-right))' }}
            >
              <span className="pointer-events-auto">
                <IconButton label="Deshacer (⌘Z)" onClick={api.undo} disabled={!api.canUndo} size={44}>
                  <Undo2 size={20} />
                </IconButton>
              </span>
              <span className="pointer-events-auto">
                <IconButton label="Rehacer (⇧⌘Z)" onClick={api.redo} disabled={!api.canRedo} size={44}>
                  <Redo2 size={20} />
                </IconButton>
              </span>
              <span className="pointer-events-auto">
                <IconButton label={playing ? 'Detener (espacio)' : 'Escuchar (espacio)'} onClick={togglePlay} tone="coral" active={playing} size={44}>
                  {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                </IconButton>
              </span>
              <span className="pointer-events-auto">
                <IconButton label="Mostrar barras y paleta (F)" onClick={() => setFocus(false)} tone="sun" active size={44}>
                  <Minimize2 size={20} />
                </IconButton>
              </span>
            </div>
          )}
          <ScoreCanvas
            measures={score.measures}
            transposition={score.transposition}
            selectedId={selectedId}
            cursorId={cursorId}
            loopMode={loopOn}
            loopRange={loopOn ? loopRange : null}
            fingerDraw={fingerDraw}
            mode={mode}
            annotations={score.annotations ?? NO_ANNOTATIONS}
            setMeasures={api.setMeasures}
            setAnnotations={api.setAnnotations}
            onSelect={setSelectedId}
            onBadge={onBadge}
            onToast={showToast}
            onEdit={stopPlayback}
            background={score.background}
            bgUrl={bgUrl}
            adjustBg={adjustBg && !!score.background}
            onBackground={onBackground}
            onScan={() => setModal('scan')}
            meter={meter}
            userZoom={userZoom}
            onUserZoom={setUserZoom}
          />
          {/* Zoom: pellizcar con dos dedos (o el trackpad), o estos botones */}
          <div className="pointer-events-none absolute bottom-16 right-4 z-30 flex items-center gap-1 rounded-full border border-line bg-panel/95 p-1 shadow backdrop-blur">
            <button type="button" aria-label="Alejar" onClick={() => zoomBy(0.8)} className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full">
              <ZoomOut size={17} />
            </button>
            <button
              type="button"
              aria-label="Zoom al 100%"
              title="Toca para volver al 100%"
              onClick={() => setUserZoom(1)}
              className="pointer-events-auto h-9 min-w-[52px] rounded-full px-1 text-xs font-extrabold tabular-nums"
            >
              {Math.round(userZoom * 100)}%
            </button>
            <button type="button" aria-label="Acercar" onClick={() => zoomBy(1.25)} className="pointer-events-auto grid h-9 w-9 place-items-center rounded-full">
              <ZoomIn size={17} />
            </button>
          </div>
          <AnimatePresence>
            {bgPanel && score.background && (
              <div className="pointer-events-none absolute right-4 top-3 z-40">
                <BackgroundPanel
                  bg={score.background}
                  adjust={adjustBg}
                  onAdjust={setAdjustBg}
                  onChange={onBackground}
                  onRemove={removeBackground}
                  onDetect={() => void detectNotes()}
                  detecting={detecting}
                  onClose={() => {
                    setBgPanel(false)
                    setAdjustBg(false)
                  }}
                />
              </div>
            )}
          </AnimatePresence>
          <div className="pointer-events-none absolute bottom-3 left-4 z-30 flex items-center gap-2">
            <ModeSwitch mode={mode} onMode={setMode} />
            <motion.button
              type="button"
              aria-label="Borrar toda la partitura"
              title="Borrar toda la partitura"
              onClick={() => setModal('clear')}
              whileTap={{ scale: 0.86, rotate: -6 }}
              transition={ELASTIC}
              className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full border border-line bg-panel text-bad shadow"
            >
              <Trash2 size={18} />
            </motion.button>
            {score.background && (
              <motion.button
                type="button"
                aria-label="Ajustar partitura de fondo"
                title="Ajustar partitura de fondo"
                aria-pressed={bgPanel}
                onClick={() => setBgPanel((v) => !v)}
                whileTap={{ scale: 0.86 }}
                transition={ELASTIC}
                className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full border border-line px-3 text-sm font-extrabold shadow"
                style={{ background: bgPanel ? 'var(--la)' : 'var(--panel)', color: bgPanel ? '#2b2118' : 'var(--ink)' }}
              >
                <ImageIcon size={17} /> <span className="hidden lg:inline">Fondo</span>
              </motion.button>
            )}
          </div>
          <div className="pointer-events-none absolute bottom-3 right-4 z-30 flex gap-2">
            <button
              type="button"
              aria-label="Quitar último compás"
              onClick={api.removeLastMeasure}
              className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full border border-line bg-panel shadow"
            >
              <Minus size={18} />
            </button>
            <button
              type="button"
              aria-label="Añadir compás"
              onClick={api.addMeasure}
              className="pointer-events-auto flex h-11 items-center gap-1 rounded-full bg-mint px-4 text-sm font-black text-[#12352c] shadow"
            >
              <Plus size={18} /> Compás
            </button>
          </div>
        </div>
      </div>

      {!focus && (
      <TransportBar
        ref={transportRef}
        playing={playing}
        bpm={score.bpm}
        metronome={metro}
        loop={loopOn}
        loopLabel={loopLabel}
        onPlay={togglePlay}
        onStop={stopPlayback}
        onBpm={setBpm}
        onTap={onTap}
        onMetronome={() => void toggleMetro()}
        onLoop={() => setLoopOn((v) => !v)}
      />
      )}

      <Tuner open={modal === 'tuner'} onClose={() => setModal(null)} transposition={score.transposition} />
      <ExportModal open={modal === 'export'} onClose={() => setModal(null)} score={score} onToast={showToast} />
      <HelpModal
        open={modal === 'help'}
        onClose={() => setModal(null)}
        onRecalibrate={() => {
          setModal(null)
          setCalib(true)
        }}
      />
      <AnimatePresence>
        {calib && (
          <Calibration
            key="calib"
            onClose={() => setCalib(false)}
            onDone={() => {
              setCalib(false)
              showToast('Test completado: Mila ya reconoce tu letra')
            }}
          />
        )}
      </AnimatePresence>
      <ScanSheet open={modal === 'scan'} busy={scanBusy} onClose={() => setModal(null)} onFile={(f, convert) => void handleScanFile(f, convert)} />
      <Gallery
        open={modal === 'gallery'}
        onClose={() => setModal(null)}
        items={lib.items}
        currentId={lib.currentId}
        onOpen={(id) => void openFromGallery(id)}
        onNew={newScore}
        onExample={fromExample}
        onDuplicate={duplicateItem}
        onDelete={(id) => void deleteItem(id)}
        onSaveToFiles={(items) => void saveToFiles(items)}
        onImport={(files) => void importFiles(files)}
        onScan={() => setModal('scan')}
      />
      <UiModal open={modal === 'clear'} onClose={() => setModal(null)} title="¿Borrar toda la partitura?" maxWidth={420}>
        <p className="text-sm text-muted">
          Se borran todas las notas y anotaciones y vuelve a 4 compases vacíos. El título y el tempo se mantienen.
          Si te arrepientes, <b className="text-ink">Deshacer</b> la recupera.
        </p>
        <div className="mt-5 flex gap-2">
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={ELASTIC}
            onClick={() => setModal(null)}
            className="h-12 flex-1 rounded-2xl border border-line bg-paper font-extrabold"
          >
            Cancelar
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.95 }}
            transition={ELASTIC}
            onClick={clearAll}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-bad font-extrabold text-white"
          >
            <Trash2 size={18} /> Borrar todo
          </motion.button>
        </div>
      </UiModal>
      <Toast msg={toast?.msg ?? null} tone={toast?.tone ?? 'info'} />
      <AnimatePresence>
        {updateReady && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            whileTap={{ scale: 0.95 }}
            transition={ELASTIC}
            onClick={() => void lib.flush().finally(() => window.location.reload())}
            className="fixed left-1/2 z-[70] flex h-11 -translate-x-1/2 items-center gap-2 rounded-full bg-mint px-4 text-sm font-extrabold text-[#12352c] shadow-lg"
            style={{ top: 'max(12px, env(safe-area-inset-top))' }}
          >
            <RefreshCw size={16} /> Hay una versión nueva de MILA · Actualizar
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
