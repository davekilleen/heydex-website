import { Navigate, Route, Routes } from 'react-router-dom';
import ConnectPage from './pages/ConnectPage';
import DiffPage from './pages/DiffPage';
import HadexExplorationPage from './pages/HadexExplorationPage';
import MyProfilePage from './pages/MyProfilePage';
import PublicProfilePage from './pages/PublicProfilePage';
import ReviewPage from './pages/ReviewPage';

export default function App() {
  return (
    <Routes>
      <Route path="/connect" element={<ConnectPage />} />
      <Route path="/connect/" element={<ConnectPage />} />
      <Route path="/diff" element={<DiffPage />} />
      <Route path="/diff/" element={<DiffPage />} />
      <Route path="/diff/profile" element={<MyProfilePage />} />
      <Route path="/diff/profile/" element={<MyProfilePage />} />
      <Route path="/diff/review" element={<ReviewPage />} />
      <Route path="/diff/review/" element={<ReviewPage />} />
      <Route path="/explorations/hadex" element={<HadexExplorationPage />} />
      <Route path="/explorations/hadex/" element={<HadexExplorationPage />} />
      <Route path="/diff/:handle" element={<PublicProfilePage />} />
      <Route path="/diff/:handle/" element={<PublicProfilePage />} />
      <Route path="/" element={<Navigate to="/diff/" replace />} />
      <Route path="*" element={null} />
    </Routes>
  );
}
