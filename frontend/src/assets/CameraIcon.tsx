import React from 'react';
import Svg, { Rect, Path, Circle } from 'react-native-svg';

type Props = {
  size?: number;
  color?: string;     // outline color
  fillColor?: string; // background/inside color
};

export default function CameraIcon({
  size = 24,
  color = 'black',
  fillColor = 'white',
}: Props) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M8 7l1.5-3h5L16 7Z" fill={fillColor} />
      <Rect x="2" y="7" width="20" height="14" rx="3" fill={fillColor} />
      <Circle cx="12" cy="14" r="3.5" fill={fillColor} />
      <Circle cx="18" cy="10.5" r="0.75" fill={color} />
    </Svg>
  );
}