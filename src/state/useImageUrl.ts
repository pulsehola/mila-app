import { useEffect, useState } from 'react'
import { getImage } from './library'

/** URL local (object URL) de una imagen guardada en el iPad; se libera al cambiar o desmontar. */
export function useImageUrl(imageId: string | undefined): string | null {
  const [state, setState] = useState<{ id: string; url: string } | null>(null)

  useEffect(() => {
    if (!imageId) return
    let url: string | null = null
    let alive = true
    void getImage(imageId)
      .then((blob) => {
        if (!alive || !blob) return
        url = URL.createObjectURL(blob)
        setState({ id: imageId, url })
      })
      .catch(() => undefined)
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [imageId])

  return imageId && state?.id === imageId ? state.url : null
}
