import StreamUniverse from './StreamUniverse';
import './index.css'; // garanta que o CSS global está importado

export default function App() {
  return (
    <div className="fullscreen safe-pads">
      <div className="container-outer">
        <StreamUniverse />
      </div>
    </div>
  );
}