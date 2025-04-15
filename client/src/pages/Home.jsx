import React from 'react'
import { FaSearch } from 'react-icons/fa'

function Home() {
  return (
    <div className='d-flex flex-column justify-content-center align-items-center mt-5'>
      <p className='fs-5'>Explore populor posts in the Community!</p>
      <h5 className='fs-4 fw-bold' style={{ color: 'rgb(197, 79, 197)' }}>
        ⦿ Generated with AI ⦿
      </h5>
      <div className='d-flex align-items-center search'>
        <FaSearch />
        <input
          type='text'
          style={{ background: 'transparent', border: 'none', outline: 'none', color: 'white', width: '100%' }}
          placeholder='Search with prompt or name . . .'
        />
      </div>
    </div>
  )
}

export default Home
