/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        tum: {
          yellow: 'rgb(var(--tum-yellow) / <alpha-value>)',
          'yellow-dark': 'rgb(var(--tum-yellow-dark) / <alpha-value>)',
          dark: 'rgb(var(--tum-bg) / <alpha-value>)',
          'dark-2': 'rgb(var(--tum-surface) / <alpha-value>)',
          'dark-3': 'rgb(var(--tum-surface-alt) / <alpha-value>)',
          pop: '#FACC15',
          dela: '#EC4899',
          mo: '#FACC15',
          black: '#3B82F6',
        },
      },
      animation: {
        'pulse-ring': 'pulseRing 2s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(100%)' }, to: { transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
