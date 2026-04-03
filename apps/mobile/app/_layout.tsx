import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';
import { colors } from '../src/constants/theme';

export default function RootLayout() {
  return (
    <>
      <StatusBar barStyle="light-content" backgroundColor={colors.bgPrimary} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bgSecondary },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: 'bold' },
          contentStyle: { backgroundColor: colors.bgPrimary },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Seven-Six' }} />
        <Stack.Screen name="game/[id]" options={{ title: 'Game', headerShown: false }} />
      </Stack>
    </>
  );
}
