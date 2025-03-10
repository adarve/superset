/* eslint-disable react/jsx-handler-names */
/* eslint-disable react/no-access-state-in-setstate */
/* eslint-disable camelcase */
/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { isEqual } from 'lodash';
import {
  Datasource,
  HandlerFunction,
  JsonObject,
  JsonValue,
  QueryFormData,
  SupersetClient,
  usePrevious,
} from '@superset-ui/core';
import { Layer } from '@deck.gl/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../DeckGLContainer';
import { getExploreLongUrl } from '../utils/explore';
import layerGenerators from '../layers';
import { Viewport } from '../utils/fitViewport';
import { TooltipProps } from '../components/Tooltip';

export type DeckMultiProps = {
  formData: QueryFormData;
  payload: JsonObject;
  setControlValue: (control: string, value: JsonValue) => void;
  viewport: Viewport;
  onAddFilter: HandlerFunction;
  height: number;
  width: number;
  datasource: Datasource;
  onSelect: () => void;
};

const DeckMulti = (props: DeckMultiProps) => {
  const containerRef = useRef<DeckGLContainerHandle>();

  const [viewport, setViewport] = useState<Viewport>();
  const [subSlicesLayers, setSubSlicesLayers] = useState<Record<number, Layer>>(
    {},
  );

  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  const loadLayers = useCallback(
    (formData: QueryFormData, payload: JsonObject, viewport?: Viewport) => {
      setViewport(viewport);
      setSubSlicesLayers({});
      payload.data.slices.forEach(
        (subslice: { slice_id: number } & JsonObject) => {
          // Filters applied to multi_deck are passed down to underlying charts
          // note that dashboard contextual information (filter_immune_slices and such) aren't
          // taken into consideration here
          // Get all filters including dashboard filters
          const filters = [
            ...(subslice.form_data.filters || []),
            ...(formData.filters || []),
            ...(formData.extra_filters || []),
          ];
          
          // Add dashboard applied filters if available
          // These come from dashboard filter components or cross-filtering
          if (payload.applied_filters && Array.isArray(payload.applied_filters)) {
            filters.push(...payload.applied_filters);
          } else if (payload.data && payload.data.applied_filters && Array.isArray(payload.data.applied_filters)) {
            // Check alternate location in payload structure
            filters.push(...payload.data.applied_filters);
          }
          const subsliceCopy = {
            ...subslice,
            form_data: {
              ...subslice.form_data,
              filters,
            },
          };

          const url = getExploreLongUrl(subsliceCopy.form_data, 'json');

          if (url) {
            SupersetClient.get({
              endpoint: url,
            })
              .then(({ json }) => {
                // @ts-ignore TODO(hainenber): define proper type for `form_data.viz_type` and call signature for functions in layerGenerators.
                const layer = layerGenerators[subsliceCopy.form_data.viz_type](
                  subsliceCopy.form_data,
                  json,
                  props.onAddFilter,
                  setTooltip,
                  props.datasource,
                  [],
                  props.onSelect,
                );
                setSubSlicesLayers(subSlicesLayers => ({
                  ...subSlicesLayers,
                  [subsliceCopy.slice_id]: layer,
                }));
              })
              .catch(() => {});
          }
        },
      );
    },
    [props.datasource, props.onAddFilter, props.onSelect, setTooltip],
  );

  const prevDeckSlices = usePrevious(props.formData.deck_slices);
  const prevExtraFilters = usePrevious(props.formData.extra_filters);
  const prevAppliedFilters = usePrevious(
    props.payload.applied_filters || 
    (props.payload.data && props.payload.data.applied_filters)
  );
  
  useEffect(() => {
    const { formData, payload } = props;
    const currentAppliedFilters = payload.applied_filters || 
                               (payload.data && payload.data.applied_filters);
                               
    const hasChanges = !isEqual(prevDeckSlices, formData.deck_slices) || 
                      !isEqual(prevExtraFilters, formData.extra_filters) ||
                      !isEqual(prevAppliedFilters, currentAppliedFilters);
    if (hasChanges) {
      loadLayers(formData, payload);
    }
  }, [loadLayers, prevDeckSlices, prevExtraFilters, prevAppliedFilters, props]);

  const { payload, formData, setControlValue, height, width } = props;
  const layers = Object.values(subSlicesLayers);

  return (
    <DeckGLContainerStyledWrapper
      ref={containerRef}
      mapboxApiAccessToken={payload.data.mapboxApiKey}
      viewport={viewport || props.viewport}
      layers={layers}
      mapStyle={formData.mapbox_style}
      setControlValue={setControlValue}
      onViewportChange={setViewport}
      height={height}
      width={width}
    />
  );
};

export default memo(DeckMulti);
