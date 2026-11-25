import { ViewStyle } from 'react-native';

export const floatingTabBar: ViewStyle = {
  position: 'absolute',
  bottom: 25,          
  marginLeft: '5%',
  width: '90%',
  height: 64,
  alignSelf: 'center',
  borderRadius: 32,    
  backgroundColor: 'white', 
  borderTopWidth: 0,   
  paddingTop: 0,
  paddingBottom: 0,

  shadowColor: '#000',
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.2,
  shadowRadius: 10,
};