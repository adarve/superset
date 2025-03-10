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
  usePrevious,
} from '@superset-ui/core';
import { Layer } from '@deck.gl/core';

import {
  DeckGLContainerHandle,
  DeckGLContainerStyledWrapper,
} from '../DeckGLContainer';
import layerGenerators from '../layers';
import { Viewport } from '../utils/fitViewport';
import { TooltipProps } from '../components/Tooltip';

export type DeckMultiDirectProps = {
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

/**
 * MultiDirect - An improved version of Multi chart that processes subchart data directly
 * without making additional API requests. This ensures dashboard filters are applied
 * consistently to all layers.
 */
function DeckMultiDirect(props: DeckMultiDirectProps) {
  const containerRef = useRef<DeckGLContainerHandle>();

  const [viewport, setViewport] = useState<Viewport>();
  const [subSlicesLayers, setSubSlicesLayers] = useState<Record<number, Layer>>({});

  const setTooltip = useCallback((tooltip: TooltipProps['tooltip']) => {
    const { current } = containerRef;
    if (current) {
      current.setTooltip(tooltip);
    }
  }, []);

  const generateLayers = useCallback(
    (formData: QueryFormData, payload: JsonObject, viewport?: Viewport) => {
      console.log('MultiDirect - Processing payload:', payload);
      
      // Update viewport from props if provided
      if (viewport) {
        setViewport(viewport);
      }
      
      // We need slices to create layers
      if (!payload?.data?.slices || !Array.isArray(payload.data.slices)) {
        console.error('MultiDirect - Missing slices data in payload:', payload);
        return;
      }
      
      console.log(`MultiDirect - Processing ${payload.data.slices.length} subcharts`);
      
      // Process each slice to create a layer
      const newLayers: Record<number, Layer> = {};
      
      payload.data.slices.forEach((subslice: { slice_id: number } & JsonObject) => {
        if (!subslice.form_data?.viz_type) {
          console.error(`MultiDirect - Missing viz_type for subchart ${subslice.slice_id}`);
          return;
        }
        
        // Create a copy of the subslice with filters from parent chart
        const subsliceCopy = {
          ...subslice,
          form_data: {
            ...subslice.form_data,
            // Combine filters from both parent and child
            filters: [
              ...(subslice.form_data.filters || []),
              ...(formData.filters || []),
            ],
            // Include extra_filters from parent (dashboard filters)
            ...(formData.extra_filters ? { extra_filters: formData.extra_filters } : {}),
            // Include adhoc_filters from parent if they exist
            ...(formData.adhoc_filters ? { adhoc_filters: formData.adhoc_filters } : {}),
            // Include time_range if it exists in parent
            ...(formData.time_range ? { time_range: formData.time_range } : {}),
          },
        };
        
        try {
          // If this is a data that needs to be transformed
          const vizType = subsliceCopy.form_data.viz_type;
          const layerGenerator = layerGenerators[vizType];
          
          if (!layerGenerator) {
            console.error(`MultiDirect - Unknown viz_type: ${vizType}`);
            return;
          }
          
          // Prepare a payload that looks like what the layer expects
          const subchartData = subslice.data || {};
          const processedPayload = {
            data: {
              features: subchartData.features || [],
              mapboxApiKey: payload.data.mapboxApiKey,
              ...subchartData
            },
            form_data: subsliceCopy.form_data
          };
          
          const layer = layerGenerator(
            subsliceCopy.form_data,
            processedPayload,
            props.onAddFilter,
            setTooltip,
            props.datasource,
            [], // Empty spatial extent 
            props.onSelect
          );
          
          if (layer) {
            console.log(`MultiDirect - Generated layer for subchart ${subslice.slice_id}:`, 
              layer.id, layer.props);
            newLayers[subslice.slice_id] = layer;
          }
        } catch (error) {
          console.error(`MultiDirect - Error generating layer for ${subslice.slice_id}:`, error);
        }
      });
      
      console.log(`MultiDirect - Created ${Object.keys(newLayers).length} layers`);
      setSubSlicesLayers(newLayers);
    },
    [props.datasource, props.onAddFilter, props.onSelect, setTooltip],
  );

  // Keep track of important prop changes that would require regenerating layers
  const prevDeckSlices = usePrevious(props.formData.deck_slices);
  const prevFilters = usePrevious(props.formData.filters);
  const prevExtraFilters = usePrevious(props.formData.extra_filters);
  const prevAdhocFilters = usePrevious(props.formData.adhoc_filters);
  const prevTimeRange = usePrevious(props.formData.time_range);
  const prevPayload = usePrevious(props.payload);

  useEffect(() => {
    const { formData, payload } = props;
    
    // Log debug info
    console.log('MultiDirect - Props received:', {
      formData: {
        filters: formData.filters,
        extra_filters: formData.extra_filters,
        adhoc_filters: formData.adhoc_filters,
        time_range: formData.time_range,
        deck_slices: formData.deck_slices,
      },
      payload: payload?.data,
    });
    
    // Check if any of our tracked props changed
    const slicesChanged = !isEqual(prevDeckSlices, formData.deck_slices);
    const filtersChanged = !isEqual(prevFilters, formData.filters);
    const extraFiltersChanged = !isEqual(prevExtraFilters, formData.extra_filters);
    const adhocFiltersChanged = !isEqual(prevAdhocFilters, formData.adhoc_filters);
    const timeRangeChanged = !isEqual(prevTimeRange, formData.time_range);
    const payloadChanged = !isEqual(prevPayload, payload);
    
    const hasChanges = slicesChanged || filtersChanged || extraFiltersChanged || 
                       adhocFiltersChanged || timeRangeChanged || payloadChanged;
    
    if (hasChanges) {
      console.log('MultiDirect - Changes detected, regenerating layers');
      generateLayers(formData, payload, props.viewport);
    }
  }, [
    generateLayers,
    prevDeckSlices,
    prevFilters,
    prevExtraFilters,
    prevAdhocFilters,
    prevTimeRange,
    prevPayload,
    props,
  ]);

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
}

export default memo(DeckMultiDirect);