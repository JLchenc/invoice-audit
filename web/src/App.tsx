import { Navigate, Route, Routes } from 'react-router-dom';
import BasicLayout from '@/layouts/BasicLayout';
import Review from '@/pages/Review';
import Dashboard from '@/pages/Dashboard';
import Documents from '@/pages/Documents';
import Rules from '@/pages/Rules';
import Evals from '@/pages/Evals';
import Providers from '@/pages/Providers';
import Traces from '@/pages/Traces';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<BasicLayout />}>
        <Route index element={<Navigate to="/review" replace />} />
        <Route path="review" element={<Review />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="documents" element={<Documents />} />
        <Route path="rules" element={<Rules />} />
        <Route path="evals" element={<Evals />} />
        <Route path="providers" element={<Providers />} />
        <Route path="traces" element={<Traces />} />
      </Route>
      <Route path="*" element={<Navigate to="/review" replace />} />
    </Routes>
  );
}
