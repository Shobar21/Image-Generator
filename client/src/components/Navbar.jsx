import React from 'react'
import { FaPlus, FaCompass } from 'react-icons/fa'
import { useLocation, useNavigate } from 'react-router-dom'

function Navbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const path = location.pathname.split('/')
  return (
    <div className='d-flex justify-content-between align-items-center px-3 navbar'>
      <h3>GenAI</h3>
      {path[1] === 'post' ? (
        <button className='new-btn p-2' onClick={() => navigate('/')}>
          <FaCompass className='me-2' />
          Explore
        </button>
      ) : (
        <button className='new-btn p-2' onClick={() => navigate('/post')}>
          <FaPlus className='me-2' />
          Create New Post
        </button>
      )}
    </div>
  )
}

export default Navbar
