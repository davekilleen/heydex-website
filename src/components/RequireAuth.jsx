import { useConvexAuth } from 'convex/react';
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const REQUIRE_AUTH = import.meta.env.VITE_REQUIRE_AUTH === '1';

export default function RequireAuth({ children }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const location = useLocation();

  useEffect(() => {
    if (!REQUIRE_AUTH || isLoading || isAuthenticated) return;

    const returnPath = `${location.pathname}${location.search}`;
    window.location.replace(`/connect/?return=${encodeURIComponent(returnPath)}`);
  }, [isAuthenticated, isLoading, location.pathname, location.search]);

  if (!REQUIRE_AUTH) return children;
  if (isLoading || !isAuthenticated) return null;

  return children;
}
