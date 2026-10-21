import React from 'react';
import { Box } from 'ink';
import { theme } from '../theme.js';
import { Header } from './Header.js';
import { StatusBar } from './StatusBar.js';

interface LayoutProps {
  title: string;
  hint: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Layout({ title, hint, children, footer }: LayoutProps): React.ReactElement {
  return (
    <Box flexDirection="column" height="100%">
      <Header title={title} />
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="round"
        borderColor={theme.border}
        paddingX={1}
      >
        {children}
      </Box>
      {footer}
      <StatusBar hint={hint} />
    </Box>
  );
}
