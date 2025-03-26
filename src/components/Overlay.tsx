import * as React from 'react';
import treeChanges from 'tree-changes';

import { LIFECYCLE } from '~/literals';
import {
  getClientRect,
  getDocumentHeight,
  getElement,
  getElementPosition,
  getScrollParent,
  hasCustomScrollParent,
  hasPosition,
} from '~/modules/dom';
import { getBrowser, isLegacy, log } from '~/modules/helpers';

import { Lifecycle, OverlayProps } from '~/types';

import Spotlight from './Spotlight';

interface SpotlightStyles extends React.CSSProperties {
  height: number;
  left: number;
  top: number;
  width: number;
}

interface State {
  isScrolling: boolean;
  mouseOverSpotlight: boolean;
  showSpotlight: boolean;
}

export default class JoyrideOverlay extends React.Component<OverlayProps, State> {
  isActive = false;
  resizeTimeout?: number;
  scrollTimeout?: number;
  scrollParent?: Document | Element;
  documentHeight = 0;
  state = {
    isScrolling: false,
    mouseOverSpotlight: false,
    showSpotlight: true,
  };

  componentDidMount() {
    const { debug, disableScrolling, disableScrollParentFix = false, target } = this.props;
    const element = getElement(target);

    this.scrollParent = getScrollParent(element ?? document.body, disableScrollParentFix, true);
    this.isActive = true;
    this.documentHeight = getDocumentHeight();

    if (process.env.NODE_ENV !== 'production') {
      if (!disableScrolling && hasCustomScrollParent(element, true)) {
        log({
          title: 'step has a custom scroll parent and can cause trouble with scrolling',
          data: [{ key: 'parent', value: this.scrollParent }],
          debug,
        });
      }
    }

    window.addEventListener('resize', this.handleResize);
  }

  componentDidUpdate(previousProps: OverlayProps) {
    const { disableScrollParentFix, lifecycle, spotlightClicks, target } = this.props;
    const { changed } = treeChanges(previousProps, this.props);

    if (changed('target') || changed('disableScrollParentFix')) {
      const element = getElement(target);

      this.scrollParent = getScrollParent(element ?? document.body, disableScrollParentFix, true);
    }

    if (changed('lifecycle', LIFECYCLE.TOOLTIP)) {
      this.scrollParent?.addEventListener('scroll', this.handleScroll, { passive: true });

      setTimeout(() => {
        const { isScrolling } = this.state;

        if (!isScrolling) {
          this.updateState({ showSpotlight: true });
        }
      }, 100);
    }

    if (changed('spotlightClicks') || changed('disableOverlay') || changed('lifecycle')) {
      window.removeEventListener('mousemove', this.handleMouseMove);

      // Reset mouseOverSpotlight state when lifecycle changes or spotlightClicks changes
      this.updateState({ mouseOverSpotlight: false });

      if (spotlightClicks && lifecycle === LIFECYCLE.TOOLTIP) {
        window.addEventListener('mousemove', this.handleMouseMove, false);
      }
    }
  }

  componentWillUnmount() {
    this.isActive = false;

    window.removeEventListener('mousemove', this.handleMouseMove);
    window.removeEventListener('resize', this.handleResize);

    clearTimeout(this.resizeTimeout);
    clearTimeout(this.scrollTimeout);
    this.scrollParent?.removeEventListener('scroll', this.handleScroll);

    // Reset state when unmounting
    this.updateState({ mouseOverSpotlight: false });
  }

  hideSpotlight = () => {
    const { continuous, disableOverlay, lifecycle } = this.props;
    const hiddenLifecycles = [LIFECYCLE.BEACON, LIFECYCLE.COMPLETE, LIFECYCLE.ERROR] as Lifecycle[];

    const shouldHide =
      disableOverlay ||
      (continuous ? hiddenLifecycles.includes(lifecycle) : lifecycle !== LIFECYCLE.TOOLTIP);

    if (shouldHide) {
      this.updateState({ mouseOverSpotlight: false });
    }

    return shouldHide;
  };

  get overlayStyles() {
    const { mouseOverSpotlight } = this.state;
    const { disableOverlayClose, placement, styles } = this.props;

    let baseStyles = styles.overlay;

    if (isLegacy()) {
      baseStyles = placement === 'center' ? styles.overlayLegacyCenter : styles.overlayLegacy;
    }

    return {
      cursor: disableOverlayClose ? 'default' : 'pointer',
      height: this.documentHeight,
      pointerEvents: mouseOverSpotlight ? 'none' : 'auto',
      ...baseStyles,
    } as React.CSSProperties;
  }

  get spotlightStyles(): SpotlightStyles {
    const { showSpotlight } = this.state;
    const {
      disableScrollParentFix = false,
      spotlightClicks,
      spotlightPadding = 0,
      styles,
      target,
    } = this.props;
    const element = getElement(target);
    const elementRect = getClientRect(element);
    const isFixedTarget = hasPosition(element);
    const top = getElementPosition(element, spotlightPadding, disableScrollParentFix);

    return {
      ...(isLegacy() ? styles.spotlightLegacy : styles.spotlight),
      height: Math.round((elementRect?.height ?? 0) + spotlightPadding * 2),
      left: Math.round((elementRect?.left ?? 0) - spotlightPadding),
      opacity: showSpotlight ? 1 : 0,
      pointerEvents: spotlightClicks ? 'none' : 'auto',
      position: isFixedTarget ? 'fixed' : 'absolute',
      top,
      transition: 'opacity 0.2s',
      width: Math.round((elementRect?.width ?? 0) + spotlightPadding * 2),
    } satisfies React.CSSProperties;
  }

  handleMouseMove = (event: MouseEvent) => {
    const { mouseOverSpotlight } = this.state;
    const { height, left, position, top, width } = this.spotlightStyles;

    const offsetY = position === 'fixed' ? event.clientY : event.pageY;
    const offsetX = position === 'fixed' ? event.clientX : event.pageX;
    const inSpotlightHeight = offsetY >= top && offsetY <= top + height;
    const inSpotlightWidth = offsetX >= left && offsetX <= left + width;
    const inSpotlight = inSpotlightWidth && inSpotlightHeight;

    if (inSpotlight !== mouseOverSpotlight) {
      this.updateState({ mouseOverSpotlight: inSpotlight });
    }
  };

  handleScroll = () => {
    const { target } = this.props;
    const element = getElement(target);

    if (this.scrollParent !== document) {
      const { isScrolling } = this.state;

      if (!isScrolling) {
        this.updateState({ isScrolling: true, showSpotlight: false });
      }

      clearTimeout(this.scrollTimeout);

      this.scrollTimeout = window.setTimeout(() => {
        this.updateState({ isScrolling: false, showSpotlight: true });
      }, 50);
    } else if (hasPosition(element, 'sticky')) {
      this.updateState({});
    }
  };

  handleResize = () => {
    clearTimeout(this.resizeTimeout);

    this.resizeTimeout = window.setTimeout(() => {
      if (!this.isActive) {
        return;
      }

      this.documentHeight = getDocumentHeight();
      this.forceUpdate();
    }, 100);
  };

  updateState(state: Partial<State>) {
    if (!this.isActive) {
      return;
    }

    this.setState(previousState => ({ ...previousState, ...state }));
  }

  render() {
    const { showSpotlight } = this.state;
    const { onClickOverlay, placement } = this.props;
    const { hideSpotlight, overlayStyles, spotlightStyles } = this;

    if (hideSpotlight()) {
      return null;
    }

    let spotlight = placement !== 'center' && showSpotlight && (
      <Spotlight styles={spotlightStyles} />
    );

    // Hack for Safari bug with mix-blend-mode with z-index
    if (getBrowser() === 'safari') {
      const { mixBlendMode, zIndex, ...safariOverlay } = overlayStyles;

      spotlight = <div style={{ ...safariOverlay }}>{spotlight}</div>;
      delete overlayStyles.backgroundColor;
    }

    return (
      <div
        className="react-joyride__overlay"
        data-test-id="overlay"
        onClick={onClickOverlay}
        role="presentation"
        style={overlayStyles}
      >
        {spotlight}
      </div>
    );
  }
}
