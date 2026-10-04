import Svg, { Rect, Path, Circle } from 'react-native-svg';

function CameraIcon({ size = 24, color = 'black' }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Rect x="2" y="7" width="20" height="14" rx="3" />
      <Path d="M8 7l1.5-3h5L16 7" />
      <Circle cx="12" cy="14" r="3.5" />
      <Circle cx="18" cy="10.5" r="0.75" fill={color} />
    </Svg>
  );
}

export default CameraIcon