import { useEffect, useState } from 'react';
import { useServices } from '@/services';

export function useAssetUrl(assetId: string | undefined): string | null {
  const { assets } = useServices();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!assetId) {
      setUrl(null);
      return;
    }
    assets.getUrl(assetId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [assetId, assets]);
  return url;
}
