import './App.css'
import Navbar from './components/Navbar'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import Createpost from './pages/Createpost'

function App() {
  return (
    <>
      <BrowserRouter>
        <Navbar />
        <Routes>
          <Route path='/' element={<Home />} />
          <Route path='/post' element={<Createpost />} />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
