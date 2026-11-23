import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { useRoute } from '@/lib/router';
import { AuthPage } from '@/pages/AuthPage';
import { LayoutsPage } from '@/pages/LayoutsPage';
import { createServices, ServicesProvider } from '@/services';
import { FullScreenLoader } from '@/ui/FullScreenLoader';
import { Toaster } from '@/ui/toast';

// The 3D editor pulls in three.js; load it only when needed.
const EditorPage = lazy(() => import('@/editor/EditorPage'));

const services = createServices();

function Routes() {
  const { user, ready } = useAuth();
  const route = useRoute();
  if (!ready) return <FullScreenLoader />;
  if (!user) return <AuthPage />;
  if (route.name === 'editor') {
    return (
      <Suspense fallback={<FullScreenLoader label="Loading gallery…" />}>
        <EditorPage key={route.layoutId} layoutId={route.layoutId} />
      </Suspense>
    );
  }
  return <LayoutsPage />;
}

export default function App() {
  return (
    <ServicesProvider services={services}>
      <AuthProvider>
        <Routes />
        <Toaster />
      </AuthProvider>
    </ServicesProvider>
  );
}
