import { ViewStyle } from 'react-native';

export const floatingTabBar: ViewStyle = {
  position: 'absolute',
  bottom: 25,          // how high it floats above the bottom edge
  marginLeft: '5%',
  width: '90%',
  height: 64,
  alignSelf: 'center',
  borderRadius: 32,    // half the height gives fully rounded ends
  backgroundColor: 'white', // solid, not see-through
  borderTopWidth: 0,   // removes the default thin line
  paddingTop: 0,
  paddingBottom: 0,


  // iOS shadow
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.2,
  shadowRadius: 10,

  // Android shadow
  elevation: 10,
};